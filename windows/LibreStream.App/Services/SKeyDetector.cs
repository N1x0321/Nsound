using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.ML.OnnxRuntime;

namespace LibreStream.App;

/// <summary>
/// Tono de una canción con la red neuronal S-KEY (Deezer, licencia MIT) exportada a ONNX.
/// El modo de uso (audio mono a 22 050 Hz, mínimo 3 s, 24 clases) y la comprobación de los ficheros
/// por SHA-256 siguen el proyecto KeyFindTray (MIT, «KeyFindTray contributors»); ver THIRD-PARTY-NOTICES.md.
/// Todo se ejecuta en local: no se envía audio a ningún sitio.
/// </summary>
public sealed class SKeyDetector : IDisposable
{
    public const int SampleRate = 22050;

    // Los mismos hashes que fija KeyFindTray para la revisión c04b6a2 del modelo: un fichero cambiado no se carga.
    private const string ModelSha = "50bac66d5b02868afad07a0b159f08495cc3f5d8492654587e828ed4686412b1";
    private const string KeysSha = "e13a27bae5731b7a5335e22b110ff75fa0dba8a04f436f16768169a212297e71";

    private readonly InferenceSession _session;
    private readonly string _input, _output;
    private readonly (int root, bool minor)[] _classes;

    private SKeyDetector(InferenceSession session, (int, bool)[] classes)
    {
        _session = session; _classes = classes;
        _input = session.InputMetadata.Keys.First();
        _output = session.OutputMetadata.Keys.First();
    }

    /// <summary>Carga el modelo de <c>Assets/models/skey</c>; null si falta, no coincide el hash o ONNX Runtime falla.</summary>
    public static SKeyDetector? TryLoad()
    {
        // ONNX Runtime no publica binario de Windows de 32 bits: en x86 se usa el método propio (KeyBpmAnalyzer)
        if (RuntimeInformation.ProcessArchitecture == Architecture.X86) return null;
        try
        {
            var dir = Path.Combine(AppContext.BaseDirectory, "Assets", "models", "skey");
            var model = File.ReadAllBytes(Path.Combine(dir, "skey.onnx"));
            var keys = File.ReadAllBytes(Path.Combine(dir, "skey-keys.json"));
            if (Hex(SHA256.HashData(model)) != ModelSha || Hex(SHA256.HashData(keys)) != KeysSha) return null;
            var labels = JsonSerializer.Deserialize<string[]>(keys);
            if (labels is null || labels.Length != 24) return null;
            var classes = labels.Select(Parse).ToArray();
            OrtEnv.Instance().DisableTelemetryEvents();
            using var opt = new SessionOptions { GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL, InterOpNumThreads = 1, IntraOpNumThreads = 1 };
            return new SKeyDetector(new InferenceSession(model, opt), classes);
        }
        catch { return null; }
    }

    /// <summary>Tono más probable de un fragmento mono a 22 050 Hz (≥ 3 s), con su «confianza» (peso softmax); null si no hay lectura.</summary>
    public (int root, bool minor, double confidence)? Detect(float[] mono22k)
    {
        if (mono22k.Length < SampleRate * 3) return null;
        try
        {
            using var audio = OrtValue.CreateTensorValueFromMemory(OrtMemoryInfo.DefaultInstance, mono22k.AsMemory(), new long[] { 1, mono22k.Length });
            using var res = _session.Run(new RunOptions(), new[] { _input }, new[] { audio }, new[] { _output });
            var raw = res[0].GetTensorDataAsSpan<float>();
            if (raw.Length != 24) return null;
            double max = double.MinValue; int best = 0;
            for (int i = 0; i < 24; i++)
            {
                if (float.IsNaN(raw[i]) || float.IsInfinity(raw[i])) return null;
                if (raw[i] > max) { max = raw[i]; best = i; }
            }
            double sum = 0; for (int i = 0; i < 24; i++) sum += Math.Exp(raw[i] - max);
            return (_classes[best].root, _classes[best].minor, 1 / sum);
        }
        catch { return null; }
    }

    /// <summary>Remuestrea (interpolación lineal) de la frecuencia de captura a 22 050 Hz.</summary>
    public static float[] Resample(float[] x, int rate)
    {
        if (rate == SampleRate) return x;
        int n = (int)((long)x.Length * SampleRate / rate);
        var y = new float[n];
        double step = (double)rate / SampleRate;
        for (int i = 0; i < n; i++)
        {
            double p = i * step; int k = (int)p; double f = p - k;
            y[i] = k + 1 < x.Length ? (float)(x[k] * (1 - f) + x[k + 1] * f) : x[Math.Min(k, x.Length - 1)];
        }
        return y;
    }

    // «Bb Major», «C# minor»… → (0 = Do … 11 = Si, menor?)
    private static (int, bool) Parse(string label)
    {
        var p = label.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        int pc = p[0] switch { "C" => 0, "C#" or "Db" => 1, "D" => 2, "D#" or "Eb" => 3, "E" => 4, "F" => 5, "F#" or "Gb" => 6, "G" => 7, "G#" or "Ab" => 8, "A" => 9, "A#" or "Bb" => 10, "B" => 11, _ => throw new InvalidDataException(label) };
        return (pc, p[1].StartsWith("min", StringComparison.OrdinalIgnoreCase));
    }

    private static string Hex(byte[] b) => Convert.ToHexString(b).ToLowerInvariant();

    public void Dispose() => _session.Dispose();
}
