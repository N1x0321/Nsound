namespace LibreStream.Core.Services.Audio;

/// <summary>Resultado de analizar un fragmento de audio.</summary>
public sealed record KeyBpmResult(double Bpm, double BpmConfidence, int KeyRoot, bool Minor, double KeyConfidence)
{
    static readonly string[] Names = { "Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si" };
    public string KeyName => Names[KeyRoot] + (Minor ? " menor" : " mayor");

    /// <summary>Texto corto para mostrar: "La menor · 128 BPM" (solo lo que sea fiable).</summary>
    public string Label
    {
        get
        {
            var parts = new List<string>();
            if (KeyConfidence >= 0.45) parts.Add(KeyName);
            if (BpmConfidence >= 0.2 && Bpm > 0) parts.Add($"{Math.Round(Bpm)} BPM");
            return string.Join(" · ", parts);
        }
    }
}

/// <summary>
/// Estima tono (Krumhansl-Schmuckler sobre un cromagrama) y tempo (autocorrelación del flujo de energía)
/// de un fragmento de audio mono. Todo en memoria: no se guarda ni se envía audio.
/// </summary>
public static class KeyBpmAnalyzer
{
    static readonly double[] MajorProfile = { 6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88 };
    static readonly double[] MinorProfile = { 6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17 };

    public static KeyBpmResult? Analyze(float[] mono, int sampleRate)
    {
        if (mono.Length < sampleRate * 6) return null;           // hace falta un rato de audio
        double sum = 0; foreach (var s in mono) sum += s * s;
        if (Math.Sqrt(sum / mono.Length) < 0.003) return null;   // silencio
        var (bpm, bc) = Tempo(mono, sampleRate);
        var (root, minor, kc) = Key(mono, sampleRate);
        return new KeyBpmResult(bpm, bc, root, minor, kc);
    }

    // ---------- tempo ----------
    public static (double bpm, double conf) Tempo(float[] x, int sr)
    {
        int hop = Math.Max(64, sr / 200);                        // ~5 ms por trama
        int n = x.Length / hop;
        var env = new double[n];
        for (int i = 0; i < n; i++)
        {
            double e = 0;
            for (int j = 0; j < hop; j++) { var s = x[i * hop + j]; e += s * s; }
            env[i] = Math.Sqrt(e / hop);
        }
        var flux = new double[n];
        for (int i = 1; i < n; i++) flux[i] = Math.Max(0, env[i] - env[i - 1]);
        double mean = flux.Average();
        for (int i = 0; i < n; i++) flux[i] -= mean;
        double fps = sr / (double)hop;
        int lo = (int)Math.Floor(fps * 60 / 180), hi = (int)Math.Ceiling(fps * 60 / 60);
        double r0 = 0; for (int i = 0; i < n; i++) r0 += flux[i] * flux[i];
        if (r0 <= 1e-12 || hi >= n / 2) return (0, 0);
        var ac = new double[hi + 2];
        for (int lag = lo; lag <= hi + 1 && lag < n; lag++)
        {
            double s = 0;
            for (int i = lag; i < n; i++) s += flux[i] * flux[i - lag];
            ac[lag] = s / r0;
        }
        // tempo entre 70 y 180; se favorece lo cercano a 120 para no caer en dobles/mitades
        int best = -1; double bestScore = 0;
        for (int lag = lo; lag <= hi; lag++)
        {
            double b = fps * 60 / lag; if (b < 70 || b > 180) continue;
            double w = Math.Exp(-0.5 * Math.Pow(Math.Log2(b / 120) / 0.9, 2));
            double sc = ac[lag] * (0.7 + 0.3 * w);
            if (sc > bestScore) { bestScore = sc; best = lag; }
        }
        if (best < 0) return (0, 0);
        double refined = best;
        if (best > lo && best < hi)
        {
            double a = ac[best - 1], b = ac[best], c = ac[best + 1], d = a - 2 * b + c;
            if (Math.Abs(d) > 1e-12) refined = best + 0.5 * (a - c) / d;
        }
        return (fps * 60 / refined, Math.Clamp(ac[best], 0, 1));
    }

    // ---------- tono ----------
    public static (int root, bool minor, double conf) Key(float[] x, int sr)
    {
        const int N = 8192;
        var chroma = new double[12];
        var re = new double[N]; var im = new double[N];
        var win = new double[N];
        for (int i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (N - 1));
        int frames = 0;
        for (int start = 0; start + N <= x.Length; start += N)
        {
            for (int i = 0; i < N; i++) { re[i] = x[start + i] * win[i]; im[i] = 0; }
            Fft(re, im);
            for (int k = 1; k < N / 2; k++)
            {
                double f = k * (double)sr / N; if (f < 65 || f > 2000) continue;
                double mag = Math.Sqrt(re[k] * re[k] + im[k] * im[k]);
                double midi = 69 + 12 * Math.Log2(f / 440);
                int pc = (int)Math.Round(midi) % 12; if (pc < 0) pc += 12;
                chroma[pc] += Math.Log(1 + 10 * mag);
            }
            frames++;
        }
        if (frames == 0) return (0, false, 0);
        double bestR = double.MinValue; int bRoot = 0; bool bMin = false;
        for (int root = 0; root < 12; root++)
            for (int m = 0; m < 2; m++)
            {
                var prof = m == 0 ? MajorProfile : MinorProfile;
                var rot = new double[12];
                for (int i = 0; i < 12; i++) rot[i] = chroma[(root + i) % 12];
                double r = Pearson(rot, prof);
                if (r > bestR) { bestR = r; bRoot = root; bMin = m == 1; }
            }
        return (bRoot, bMin, Math.Clamp(bestR, 0, 1));
    }

    static double Pearson(double[] a, double[] b)
    {
        double ma = a.Average(), mb = b.Average(), sab = 0, sa = 0, sb = 0;
        for (int i = 0; i < a.Length; i++) { double da = a[i] - ma, db = b[i] - mb; sab += da * db; sa += da * da; sb += db * db; }
        return sa <= 0 || sb <= 0 ? 0 : sab / Math.Sqrt(sa * sb);
    }

    static void Fft(double[] re, double[] im)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { (re[i], re[j]) = (re[j], re[i]); (im[i], im[j]) = (im[j], im[i]); }
        }
        for (int len = 2; len <= n; len <<= 1)
        {
            double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
            for (int i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++)
                {
                    int u = i + k, v = i + k + len / 2;
                    double tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
                    re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
                    double ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
                }
            }
        }
    }
}
