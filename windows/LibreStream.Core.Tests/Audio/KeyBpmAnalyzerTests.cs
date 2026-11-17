using LibreStream.Core.Services.Audio;
using Xunit;

namespace LibreStream.Core.Tests.Audio;

public class KeyBpmAnalyzerTests
{
    const int SR = 22050;

    static float[] Song(double bpm, int[] midiNotes, double seconds)
    {
        var x = new float[(int)(SR * seconds)];
        double beat = 60.0 / bpm;
        for (int i = 0; i < x.Length; i++)
        {
            double t = (double)i / SR;
            double phase = (t % beat) / beat;
            double env = Math.Exp(-phase * 8);                       // golpe al inicio de cada pulso
            double s = 0;
            foreach (var m in midiNotes) s += Math.Sin(2 * Math.PI * 440 * Math.Pow(2, (m - 69) / 12.0) * t);
            x[i] = (float)(0.15 * s / midiNotes.Length * (0.3 + env));
        }
        return x;
    }

    /// <summary>Bombo sintético: golpe grave que decae al inicio de cada pulso.</summary>
    static float[] Kicks(double bpm, double seconds)
    {
        var x = new float[(int)(SR * seconds)];
        double beat = 60.0 / bpm;
        for (int i = 0; i < x.Length; i++)
        {
            double t = (double)i / SR, local = t % beat;
            x[i] = (float)(0.5 * Math.Exp(-local * 25) * Math.Sin(2 * Math.PI * 70 * local));
        }
        return x;
    }

    [Fact]
    public void Detecta_tempo_de_un_pulso_regular()
    {
        var (bpm, conf) = KeyBpmAnalyzer.Tempo(Kicks(120, 14), SR);
        Assert.InRange(bpm, 117, 123);
        Assert.True(conf > 0.2);
    }

    [Fact]
    public void Detecta_tono_de_la_menor_y_do_mayor()
    {
        var am = KeyBpmAnalyzer.Key(Song(100, new[] { 57, 60, 64, 57, 45 }, 14), SR);   // La, Do, Mi
        Assert.Equal(9, am.root); Assert.True(am.minor);
        var c = KeyBpmAnalyzer.Key(Song(100, new[] { 60, 64, 67, 48, 55 }, 14), SR);    // Do, Mi, Sol
        Assert.Equal(0, c.root); Assert.False(c.minor);
    }

    [Fact]
    public void Silencio_o_poco_audio_no_da_resultado()
    {
        Assert.Null(KeyBpmAnalyzer.Analyze(new float[SR * 10], SR));
        Assert.Null(KeyBpmAnalyzer.Analyze(Song(120, new[] { 60 }, 2), SR));
    }
}
