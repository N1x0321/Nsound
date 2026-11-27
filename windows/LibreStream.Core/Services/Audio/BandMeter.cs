namespace LibreStream.Core.Services.Audio;

/// <summary>
/// Niveles en vivo para el visualizador: 4 bandas (graves, medios-graves, medios, agudos) a partir de lo que suena, cada una de 0 a 1.
/// Filtros de un polo en cascada (muy barato), subida rápida y bajada suave, y ganancia automática: se adapta al volumen, así que las
/// barras se mueven igual con el volumen bajo o alto. Solo mide; no guarda ni envía audio.
/// </summary>
public sealed class BandMeter
{
    public const int Count = 4;
    private static readonly double[] Cutoffs = [180, 900, 3500];   // Hz: fronteras entre bandas

    private readonly double[] _lp = new double[3];
    private readonly double[] _level = new double[Count];
    private readonly double[] _peak = [1e-4, 1e-4, 1e-4, 1e-4];
    private readonly object _lock = new();

    /// <summary>Procesa un bloque de muestras mono (de −1 a 1).</summary>
    public void Process(ReadOnlySpan<float> mono, int sampleRate)
    {
        if (mono.Length == 0 || sampleRate <= 0) return;
        Span<double> a = stackalloc double[3];
        for (var k = 0; k < 3; k++) a[k] = 1 - Math.Exp(-2 * Math.PI * Cutoffs[k] / sampleRate);
        Span<double> energy = stackalloc double[Count];
        lock (_lock)
        {
            foreach (var x in mono)
            {
                double s = x;
                for (var k = 0; k < 3; k++) _lp[k] += a[k] * (s - _lp[k]);
                double b0 = _lp[0], b1 = _lp[1] - _lp[0], b2 = _lp[2] - _lp[1], b3 = s - _lp[2];
                energy[0] += b0 * b0; energy[1] += b1 * b1; energy[2] += b2 * b2; energy[3] += b3 * b3;
            }
            var dt = (double)mono.Length / sampleRate;
            for (var b = 0; b < Count; b++)
            {
                var rms = Math.Sqrt(energy[b] / mono.Length);
                // ganancia automática: el pico baja despacio (≈ 4 s) y sube al momento
                _peak[b] = Math.Max(rms, _peak[b] * Math.Exp(-dt / 4));
                var target = rms < 1e-4 ? 0 : Math.Clamp(rms / Math.Max(_peak[b], 1e-3), 0, 1);
                var tau = target > _level[b] ? 0.03 : 0.25;   // sube en 30 ms, baja en 250 ms
                _level[b] += (target - _level[b]) * (1 - Math.Exp(-dt / tau));
            }
        }
    }

    /// <summary>Copia los niveles actuales (0–1) en <paramref name="dest"/> (al menos 4 huecos).</summary>
    public void Read(Span<double> dest)
    {
        lock (_lock) for (var b = 0; b < Count && b < dest.Length; b++) dest[b] = _level[b];
    }

    /// <summary>Vuelve todo a cero (al cambiar de canción).</summary>
    public void Reset()
    {
        lock (_lock)
        {
            Array.Clear(_lp); Array.Clear(_level);
            for (var b = 0; b < Count; b++) _peak[b] = 1e-4;
        }
    }
}
