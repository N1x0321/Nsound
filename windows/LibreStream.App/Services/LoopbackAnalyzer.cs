using LibreStream.Core.Services.Audio;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace LibreStream.App;

/// <summary>
/// Escucha lo que suena por la salida del PC (WASAPI «loopback») y estima tono y BPM con
/// <see cref="KeyBpmAnalyzer"/>. El audio solo pasa por un búfer circular en memoria de unos 14 s:
/// no se guarda, no se envía y no se toca el reproductor. Mide TODO lo que suene en el PC, no solo Nsound.
/// </summary>
public sealed class LoopbackAnalyzer : IDisposable
{
    private const double Seconds = 14;
    private readonly object _lock = new();
    private WasapiLoopbackCapture? _cap;
    private float[] _ring = Array.Empty<float>();
    private int _pos, _filled, _rate, _sinceAnalysis;
    private volatile bool _busy, _logged;
    private readonly SKeyDetector? _skey = SKeyDetector.TryLoad();   // red neuronal S-KEY; si falta, se usa el método propio
    private readonly List<KeyBpmResult> _hist = new();   // últimos resultados de esta canción

    /// <summary>Texto listo para mostrar ("La menor · 128 BPM"), o "" si aún no hay nada fiable. Se lanza desde un hilo de fondo.</summary>
    public event Action<string>? Updated;

    public bool Running => _cap is not null;

    public void Start()
    {
        if (_cap is not null) return;
        try
        {
            _cap = new WasapiLoopbackCapture();
            _rate = _cap.WaveFormat.SampleRate;
            lock (_lock) { _ring = new float[(int)(_rate * Seconds)]; _pos = _filled = _sinceAnalysis = 0; }
            _cap.DataAvailable += OnData;
            _cap.RecordingStopped += (_, _) => { };
            _cap.StartRecording();
        }
        catch { Stop(); }   // sin dispositivo de salida o sin permiso: simplemente no hay análisis
    }

    /// <summary>Vacía el búfer (al cambiar de canción) para no mezclar dos temas.</summary>
    public void Reset()
    {
        lock (_lock) { _pos = _filled = _sinceAnalysis = 0; _hist.Clear(); }
        Updated?.Invoke("");
    }

    public void Stop()
    {
        var c = _cap; _cap = null;
        if (c is null) return;
        try { c.DataAvailable -= OnData; c.StopRecording(); c.Dispose(); } catch { /* ya parado */ }
    }

    private void OnData(object? sender, WaveInEventArgs e)
    {
        var fmt = (sender as WasapiLoopbackCapture)?.WaveFormat;
        if (fmt is null || fmt.Encoding != WaveFormatEncoding.IeeeFloat && fmt.BitsPerSample != 32) { if (!_logged) { _logged = true; try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "nsound-keybpm.log"), $"formato no admitido: {fmt}\n"); } catch { } } return; }
        int ch = Math.Max(1, fmt.Channels), frames = e.BytesRecorded / (4 * ch);
        bool run = false;
        lock (_lock)
        {
            if (_ring.Length == 0) return;
            for (int i = 0; i < frames; i++)
            {
                float s = 0;
                for (int c = 0; c < ch; c++) s += BitConverter.ToSingle(e.Buffer, (i * ch + c) * 4);
                _ring[_pos] = s / ch;
                _pos = (_pos + 1) % _ring.Length;
            }
            _filled = Math.Min(_ring.Length, _filled + frames);
            _sinceAnalysis += frames;
            if (_filled >= _rate * 8 && _sinceAnalysis >= _rate * 4 && !_busy) { run = true; _sinceAnalysis = 0; }
        }
        if (run) Analyze();
    }

    private void Analyze()
    {
        _busy = true;
        Task.Run(() =>
        {
            try
            {
                float[] copy; int rate;
                lock (_lock)
                {
                    copy = new float[_filled]; rate = _rate;
                    int start = (_pos - _filled + _ring.Length) % _ring.Length;
                    for (int i = 0; i < _filled; i++) copy[i] = _ring[(start + i) % _ring.Length];
                }
                var full = copy; int fullRate = rate;
                // se baja a ~12 kHz para que el análisis sea ligero
                int f = Math.Max(1, rate / 12000);
                if (f > 1)
                {
                    var d = new float[copy.Length / f];
                    for (int i = 0; i < d.Length; i++) { float s = 0; for (int j = 0; j < f; j++) s += copy[i * f + j]; d[i] = s / f; }
                    copy = d; rate /= f;
                }
                var res = KeyBpmAnalyzer.Analyze(copy, rate);
                string motor = "propio";
                if (res is not null && _skey is not null && _skey.Detect(SKeyDetector.Resample(full, fullRate)) is { } k)
                {
                    res = res with { KeyRoot = k.root, Minor = k.minor, KeyConfidence = k.confidence };
                    motor = "S-KEY";
                }
                try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "nsound-keybpm.log"), $"{DateTime.Now:HH:mm:ss} [{motor}] rate={rate} n={copy.Length} -> {(res is null ? "sin resultado (silencio/poco audio)" : $"{res.KeyName} c={res.KeyConfidence:0.00} · {res.Bpm:0} BPM c={res.BpmConfidence:0.00}")}\n"); } catch { }
                Updated?.Invoke(Stable(res));
            }
            catch { /* un análisis fallido no molesta */ }
            finally { _busy = false; }
        });
    }

    /// <summary>
    /// Con música real cada análisis suelto baila; solo se muestra lo que se repite en los últimos 3 análisis
    /// (mismo tono, o BPM dentro de ±3 %, contando también la mitad y el doble). Así no se enseña un dato inventado.
    /// </summary>
    private string Stable(KeyBpmResult? res)
    {
        List<KeyBpmResult> h;
        lock (_lock)
        {
            if (res is not null) { _hist.Add(res); if (_hist.Count > 3) _hist.RemoveAt(0); }
            h = _hist.ToList();
        }
        if (h.Count < 3) return "";
        var parts = new List<string>();
        var key = h[^1];
        if (h.All(r => r.KeyRoot == key.KeyRoot && r.Minor == key.Minor && r.KeyConfidence >= 0.2)) parts.Add(key.KeyName);   // con poca seguridad no se muestra
        double b = h[^1].Bpm;
        bool Near(double x) => b > 0 && x > 0 && (Math.Abs(x / b - 1) < 0.03 || Math.Abs(x * 2 / b - 1) < 0.03 || Math.Abs(x / 2 / b - 1) < 0.03);
        if (h.All(r => Near(r.Bpm))) parts.Add($"{Math.Round(b)} BPM");
        return string.Join(" · ", parts);
    }

    public void Dispose() { Stop(); _skey?.Dispose(); }
}
