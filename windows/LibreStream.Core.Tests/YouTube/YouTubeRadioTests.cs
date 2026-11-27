using System.Text.Json;
using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class YouTubeRadioTests
{
    private static string Item(string id, string title, string byline, string length, string thumb = "https://lh3.googleusercontent.com/x=w60-h60")
        => "{\"playlistPanelVideoRenderer\":{\"videoId\":\"" + id + "\",\"title\":{\"runs\":[{\"text\":\"" + title + "\"}]},"
           + "\"longBylineText\":{\"runs\":[" + string.Join(",", byline.Split('|').Select(t => "{\"text\":" + JsonSerializer.Serialize(t) + "}")) + "]},"
           + "\"lengthText\":{\"runs\":[{\"text\":\"" + length + "\"}]},\"thumbnail\":{\"thumbnails\":[{\"url\":\"" + thumb + "\"}]}}}";

    [Fact]
    public void RadioBodyAsksForTheSongsRadio()
    {
        using var doc = JsonDocument.Parse(YouTubeMusic.RadioBody("abcdefghijk"));
        Assert.Equal("abcdefghijk", doc.RootElement.GetProperty("videoId").GetString());
        Assert.Equal("RDAMVMabcdefghijk", doc.RootElement.GetProperty("playlistId").GetString());
        Assert.Equal("WEB_REMIX", doc.RootElement.GetProperty("context").GetProperty("client").GetProperty("clientName").GetString());
    }

    [Fact]
    public void ParsesTheRadioWithoutTheSeedOrRepeats()
    {
        var json = "{\"contents\":[" + Item("abcdefghijk", "Semilla", "Shakira", "4:00") + ","
            + Item("AAAAAAAAAAA", "Hips Don't Lie", "Shakira| • |Oral Fixation| • |2006", "3:38") + ","
            + "{\"playlistPanelVideoWrapperRenderer\":{\"primaryRenderer\":" + Item("BBBBBBBBBBB", "Waka Waka", "Shakira| • |2010", "3:22") + "}},"
            + Item("AAAAAAAAAAA", "Hips Don't Lie (otra vez)", "Shakira", "3:38") + "]}";
        var r = YouTubeMusic.ParseRadio(json, "abcdefghijk");
        Assert.Equal(["AAAAAAAAAAA", "BBBBBBBBBBB"], r.Select(v => v.Id));
        Assert.Equal("Shakira · Oral Fixation", r[0].Channel);
        Assert.Equal("Shakira", r[1].Channel);
        Assert.Equal(218, r[0].DurationSec);
        Assert.EndsWith("=w544-h544", r[0].Art);
        Assert.Empty(YouTubeMusic.ParseRadio("no es json"));
    }

    [Fact]
    public void PickSkipsWhatIsQueuedLiveOrTooLong()
    {
        var radio = new[]
        {
            new YouTubeVideo("AAAAAAAAAAA", "Ya en la cola", "X", 200),
            new YouTubeVideo("BBBBBBBBBBB", "Directo", "X", 0),
            new YouTubeVideo("CCCCCCCCCCC", "Mix de 2 horas", "X", 7200),
            new YouTubeVideo("DDDDDDDDDDD", "Buena", "X", 180),
            new YouTubeVideo("DDDDDDDDDDD", "Buena repetida", "X", 180),
            new YouTubeVideo("EEEEEEEEEEE", "Otra", "X", 210),
        };
        Assert.Equal(["DDDDDDDDDDD", "EEEEEEEEEEE"], YouTubeMusic.PickRadio(radio, ["AAAAAAAAAAA"]).Select(v => v.Id));
        Assert.Single(YouTubeMusic.PickRadio(radio, [], max: 1));
    }
}
