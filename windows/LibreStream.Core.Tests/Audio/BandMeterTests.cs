using LibreStream.Core.Services.Audio;
using Xunit;

namespace LibreStream.Core.Tests.Audio;

public class BandMeterTests
{
    private const int SR = 48000;

    private static double[] Feed(Func<double, double> signal, double seconds = 1.0)
    {
        var m = new BandMeter();
        var block = new float[480];   // bloques de 10 ms, como llega el audio real
        var n = 0;
        for (var done = 0; done < SR * seconds; done += block.Length)
        {
            for (var i = 0; i < block.Length; i++, n++) block[i] = (float)signal((double)n / SR);
            m.Process(block, SR);
        }
        var levels = new double[BandMeter.Count];
        m.Read(levels);
        return levels;
    }

    [Fact]
    public void BassToneLightsTheLowBand()
    {
        var l = Feed(t => 0.5 * Math.Sin(2 * Math.PI * 60 * t));
        Assert.True(l[0] > 0.6, string.Join(", ", l));
    }

    [Fact]
    public void ChordWithBassAndTrebleLightsBothEnds()
    {
        var l = Feed(t => 0.3 * Math.Sin(2 * Math.PI * 60 * t) + 0.3 * Math.Sin(2 * Math.PI * 9000 * t));
        Assert.True(l[0] > 0.5 && l[3] > 0.5, string.Join(", ", l));
    }

    [Fact]
    public void QuietAndLoudLookAliveTheSame()
    {
        var quiet = Feed(t => 0.02 * Math.Sin(2 * Math.PI * 60 * t));
        var loud = Feed(t => 0.8 * Math.Sin(2 * Math.PI * 60 * t));
        Assert.True(Math.Abs(quiet[0] - loud[0]) < 0.15, $"{quiet[0]} vs {loud[0]}");   // ganancia automática
    }

    [Fact]
    public void SilenceFallsToZero()
    {
        var l = Feed(_ => 0);
        Assert.All(l, v => Assert.True(v < 0.01));
    }

    [Fact]
    public void ResetClearsLevels()
    {
        var m = new BandMeter();
        var tone = Enumerable.Range(0, 4800).Select(i => (float)(0.5 * Math.Sin(2 * Math.PI * 60 * i / SR))).ToArray();
        m.Process(tone, SR);
        m.Reset();
        var l = new double[4];
        m.Read(l);
        Assert.All(l, v => Assert.Equal(0, v));
    }
}
