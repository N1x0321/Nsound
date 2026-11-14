using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class CustomColorTests
{
    [Theory]
    [InlineData("#FF4D62", "#FF4D62")]
    [InlineData("ff4d62", "#FF4D62")]
    [InlineData("  #00ff00 ", "#00FF00")]
    public void NormalizesValidColors(string input, string expected) => Assert.Equal(expected, Themes.NormalizeHex(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#FFF")]
    [InlineData("rojo")]
    [InlineData("#GG0000")]
    [InlineData("#12345678")]
    public void RejectsInvalidColors(string? input) => Assert.Null(Themes.NormalizeHex(input));

    [Fact]
    public void YellowGetsDarkTextAndDarkBlueGetsLightText()
    {
        // el fallo que se vio: texto blanco sobre amarillo
        Assert.Equal("#161010", Themes.Custom("#FFD400").On);
        Assert.Equal("#FFFFFF", Themes.Custom("#3B2BFF").On);
    }

    [Fact]
    public void TextOnAccentAlwaysReadableForAnyColor()
    {
        // barrido de colores: el texto elegido siempre tiene al menos contraste 4,5 (AA) sobre el acento resultante
        for (var r = 0; r <= 255; r += 51)
            for (var g = 0; g <= 255; g += 51)
                for (var b = 0; b <= 255; b += 51)
                {
                    var p = Themes.Custom(Themes.ToHex(((byte)r, (byte)g, (byte)b)));
                    Themes.TryParseHex(p.Accent, out var accent);
                    Themes.TryParseHex(p.On, out var on);
                    Assert.True(Themes.Contrast(accent, on) >= 4.5, $"{r},{g},{b} → acento {p.Accent}, texto {p.On}");
                }
    }

    [Fact]
    public void AccentIsAlwaysVisibleOnItsDarkBackground()
    {
        foreach (var hex in new[] { "#000000", "#101010", "#220022", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF" })
        {
            var p = Themes.Custom(hex);
            Themes.TryParseHex(p.Accent, out var accent);
            Themes.TryParseHex(p.Bg, out var bg);
            Assert.True(Themes.Contrast(accent, bg) >= 3, $"{hex}: acento {p.Accent} sobre fondo {p.Bg}");
            Assert.True(p.Dark);
        }
    }

    [Fact]
    public void ResolveFallsBackWhenCustomColorIsMissingOrBroken()
    {
        Assert.Equal(Themes.Default, Themes.Resolve("custom", null).Id);
        Assert.Equal(Themes.Default, Themes.Resolve("custom", "no es un color").Id);
        Assert.Equal("custom", Themes.Resolve("custom", "#FF8800").Id);
        Assert.Equal("oceano", Themes.Resolve("oceano", "#FF8800").Id);
    }

    [Fact]
    public void SettingsKeepCustomLookOnlyWithAValidColor()
    {
        var ok = new AppSettings { Look = "custom", CustomAccent = "ff8800" };
        ok.Normalize();
        Assert.Equal("custom", ok.Look);
        Assert.Equal("#FF8800", ok.CustomAccent);

        var bad = new AppSettings { Look = "custom", CustomAccent = "xx" };
        bad.Normalize();
        Assert.Equal(Themes.Default, bad.Look);
        Assert.Null(bad.CustomAccent);
    }
}
