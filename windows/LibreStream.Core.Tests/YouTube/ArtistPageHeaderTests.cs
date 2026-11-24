using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class ArtistPageHeaderTests
{
    private static string Related(string id, string name)
        => "{\"musicTwoRowItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"" + id + "\"}},\"title\":{\"runs\":[{\"text\":\"" + name + "\"}]},"
           + "\"thumbnailRenderer\":{\"musicThumbnailRenderer\":{\"thumbnail\":{\"thumbnails\":[{\"url\":\"https://lh3.googleusercontent.com/" + name.Replace(" ", "") + "=w226-h226\"}]}}}}}";

    private const string Header = "\"header\":{\"musicImmersiveHeaderRenderer\":{\"title\":{\"runs\":[{\"text\":\"Bad Bunny\"}]},"
        + "\"description\":{\"runs\":[{\"text\":\"Benito Antonio Martínez Ocasio, conocido como Bad Bunny, \"},{\"text\":\"es un cantante puertorriqueño.\"}]},"
        + "\"thumbnail\":{\"musicThumbnailRenderer\":{\"thumbnail\":{\"thumbnails\":[{\"url\":\"https://yt3.googleusercontent.com/b=w540\",\"width\":540,\"height\":225},"
        + "{\"url\":\"https://yt3.googleusercontent.com/b=w1920\",\"width\":1920,\"height\":800},{\"url\":\"https://yt3.googleusercontent.com/b=w2880\",\"width\":2880,\"height\":1200}]}}},"
        + "\"monthlyListenerCount\":{\"runs\":[{\"text\":\"140 M usuarios mensuales\"}]}}}";

    [Fact]
    public void ReadsBannerBioListenersAndRelatedArtists()
    {
        var json = "{" + Header + ",\"contents\":[" + Related("UCFV8pv7slPIV_ebs6j6SPHw", "Feid") + "," + Related("UCiY3z8HAGD6BlSNKVn2kSvQ", "Bad Bunny") + ","
            + Related("UCxOascdOCWFBIkHFIobOi0A", "Rauw Alejandro") + "," + Related("UCFV8pv7slPIV_ebs6j6SPHw", "Feid") + "]}";
        var page = YouTubeMusic.ParseArtistPage(json, "Bad Bunny");
        Assert.Equal("https://yt3.googleusercontent.com/b=w1920", page.Banner);   // la grande sin pasar de 1920 px
        Assert.Equal("Benito Antonio Martínez Ocasio, conocido como Bad Bunny, es un cantante puertorriqueño.", page.Description);
        Assert.Equal("140 M usuarios mensuales", page.Listeners);
        Assert.Equal(["Feid", "Rauw Alejandro"], page.Related.Select(a => a.Name));   // ni el propio artista ni repetidos
        Assert.Equal("https://lh3.googleusercontent.com/Feid=w544-h544", page.Related[0].Art);
    }

    [Fact]
    public void SubscribersWhenThereAreNoMonthlyListeners()
    {
        var json = "{\"header\":{\"musicImmersiveHeaderRenderer\":{\"subscriptionButton\":{\"subscribeButtonRenderer\":{\"subscriberCountText\":{\"runs\":[{\"text\":\"53,4 M\"}]}}}}}}";
        var page = YouTubeMusic.ParseArtistPage(json, "X");
        Assert.Equal("53,4 M suscriptores", page.Listeners);
        Assert.Null(page.Banner);
        Assert.Equal("", page.Description);
    }

    [Fact]
    public void PageWithoutHeaderStillWorks()
    {
        var page = YouTubeMusic.ParseArtistPage("{\"contents\":[]}", "X");
        Assert.Empty(page.Related);
        Assert.Equal("", page.Listeners);
    }
}
