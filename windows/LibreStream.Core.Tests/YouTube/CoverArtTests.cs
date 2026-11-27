using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class CoverArtTests
{
    private const string Sq = "https://lh3.googleusercontent.com/abc=w544-h544";

    [Fact]
    public void KnowsSquareCoversFromVideoFrames()
    {
        Assert.True(CoverArt.IsSquare(Sq));
        Assert.True(CoverArt.IsSquare("https://yt3.ggpht.com/xyz=w544-h544"));
        Assert.False(CoverArt.IsSquare("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"));
        Assert.False(CoverArt.IsSquare(null));
        Assert.False(CoverArt.IsSquare("http://lh3.googleusercontent.com/abc"));
    }

    [Fact]
    public void TinyVersionForTheBlurredBackground()
    {
        Assert.Equal("https://lh3.googleusercontent.com/abc=w48-h48", CoverArt.Tiny(Sq));
        Assert.Null(CoverArt.Tiny("https://i.ytimg.com/vi/abcdefghijk/default.jpg"));
    }

    [Fact]
    public void QueryDropsVideoNoise()
    {
        Assert.Equal("Shakira Dai Dai", CoverArt.Query("Shakira - Dai Dai (Official Video)", "shakiraVEVO"));
    }

    [Fact]
    public void PicksTheSameSongWithSquareCover()
    {
        var songs = new[]
        {
            new YouTubeVideo("zzzzzzzzzzz", "Otra canción", "Shakira · Álbum", 200, null, Sq),
            new YouTubeVideo("yyyyyyyyyyy", "Dai Dai", "Shakira · Dai Dai", 240, null, "https://i.ytimg.com/vi/yyyyyyyyyyy/hqdefault.jpg"),   // sin portada cuadrada
            new YouTubeVideo("xxxxxxxxxxx", "Dai Dai", "Shakira & Burna Boy · Dai Dai", 240, null, Sq),
        };
        Assert.Equal("xxxxxxxxxxx", CoverArt.PickSong(songs, "abcdefghijk", "Shakira - Dai Dai (Official Video)", "shakiraVEVO")!.Id);
    }

    [Fact]
    public void SameIdWinsAndNothingWhenUnrelated()
    {
        var songs = new[]
        {
            new YouTubeVideo("xxxxxxxxxxx", "Dai Dai", "Shakira", 240, null, Sq),
            new YouTubeVideo("abcdefghijk", "Dai Dai (versión)", "Shakira", 240, null, Sq),
        };
        Assert.Equal("abcdefghijk", CoverArt.PickSong(songs, "abcdefghijk", "Dai Dai", "Shakira")!.Id);
        Assert.Null(CoverArt.PickSong([new YouTubeVideo("xxxxxxxxxxx", "Hips Don't Lie", "Shakira", 220, null, Sq)], "abcdefghijk", "Shakira - Dai Dai", "shakiraVEVO"));
        Assert.Null(CoverArt.PickSong([new YouTubeVideo("xxxxxxxxxxx", "Dai Dai", "Otro Artista", 220, null, Sq)], "abcdefghijk", "Shakira - Dai Dai", "shakiraVEVO"));
    }
}
