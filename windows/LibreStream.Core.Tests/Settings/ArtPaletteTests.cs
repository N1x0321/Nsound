using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class ArtPaletteTests
{
    private static byte[] Pixels(params ((byte R, byte G, byte B) c, int n)[] parts)
    {
        var list = new List<byte>();
        foreach (var (c, n) in parts)
            for (var i = 0; i < n; i++) list.AddRange([c.B, c.G, c.R, 255]);
        return [.. list];
    }

    [Fact]
    public void PicksTheVividHueNotTheGreyAverage()
    {
        // mucho gris y negro con una mancha roja viva: gana el rojo, no la media
        var px = Pixels(((128, 128, 128), 300), ((5, 5, 5), 200), ((220, 30, 40), 60));
        var c = ArtPalette.Vibrant(px)!.Value;
        Assert.True(c.R > 180 && c.G < 80 && c.B < 80);
    }

    [Fact]
    public void TheMostAbundantVividHueWins()
    {
        var px = Pixels(((30, 90, 220), 120), ((220, 40, 40), 40));
        var c = ArtPalette.Vibrant(px)!.Value;
        Assert.True(c.B > c.R);
    }

    [Fact]
    public void GreyOrEmptyImagesHaveNoColor()
    {
        Assert.Null(ArtPalette.Vibrant(Pixels(((120, 120, 120), 500), ((250, 250, 250), 100))));
        Assert.Null(ArtPalette.Vibrant([]));
        Assert.Null(ArtPalette.Vibrant(Pixels(((220, 30, 40), 0))));
    }

    [Fact]
    public void TransparentPixelsAreIgnored()
    {
        var px = Pixels(((220, 30, 40), 50));
        for (var i = 3; i < px.Length; i += 4) px[i] = 0;
        Assert.Null(ArtPalette.Vibrant(px));
    }

    [Fact]
    public void GlowKeepsTheHueWithReadableLightness()
    {
        var g = ArtPalette.Glow((60, 10, 12));          // rojo muy oscuro → rojo de brillo
        Assert.True(g.R > 200 && g.G < 90 && g.B < 90);
        var p = ArtPalette.Glow((150, 160, 200));       // azul apagado → azul más vivo
        Assert.True(p.B > p.R && p.B > 180);
    }
}
