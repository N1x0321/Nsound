using System.Text.Json;
using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

/// <summary>Casos portados de app/test/core.test.mjs (éxitos y artistas por país, estanterías de Vídeos).</summary>
public class YouTubeChartsTests
{
    private static string Thumb(string url) => "\"thumbnail\":{\"musicThumbnailRenderer\":{\"thumbnail\":{\"thumbnails\":[{\"url\":\"https://lh3/x=w60-h60\"},{\"url\":\"" + url + "\"}]}}}";

    private static string Art(string id, string name, string? url = null)
        => "{\"musicResponsiveListItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"" + id + "\"}},"
           + (url is null ? "" : Thumb(url) + ",") + "\"flexColumns\":[{\"musicResponsiveListItemFlexColumnRenderer\":{\"text\":{\"runs\":[{\"text\":\"" + name + "\"}]}}}]}}";

    private static string Two(string id, string title)
        => "{\"musicTwoRowItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"" + id + "\"}},\"title\":{\"runs\":[{\"text\":\"" + title + "\"}]}}}";

    [Fact]
    public void ChartArtistsKeepRankingOrderWithoutRepeatsAndWithPhoto()
    {
        var json = "{\"charts\":[" + Art("UCbBaYg2UToDaoOwo-R6xi4g", "Anuel AA", "https://lh3/anuel=w226-h226") + ","
            + Art("UCiY3z8HAGD6BlSNKVn2kSvQ", "Bad Bunny", "https://lh3/bb=w226-h226") + ","
            + Art("UCiY3z8HAGD6BlSNKVn2kSvQ", "Bad Bunny (repetido)", "https://lh3/x") + ","
            + Art("MPREb_AAAA1111bbbb", "Un álbum") + "]}";
        var r = YouTubeMusic.ParseChartArtists(json);
        Assert.Equal(["Anuel AA", "Bad Bunny"], r.Select(a => a.Name));
        Assert.EndsWith("=w544-h544", r[0].Art);
        Assert.Empty(YouTubeMusic.ParseChartArtists("no es json"));
        Assert.Equal("FEmusic_charts", YouTubeMusic.ChartsBrowseId);
    }

    [Fact]
    public void ChartArtistsAlsoReadCardsAndTheirPhoto()
    {
        var card = "{\"musicTwoRowItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"UCiY3z8HAGD6BlSNKVn2kSvQ\"}},\"title\":{\"runs\":[{\"text\":\"Bad Bunny\"}]},\"thumbnailRenderer\":"
            + "{\"musicThumbnailRenderer\":{\"thumbnail\":{\"thumbnails\":[{\"url\":\"https://lh3/bb=w226-h226\"}]}}}}}";
        var r = YouTubeMusic.ParseChartArtists("{\"x\":[" + card + "]}");
        Assert.Single(r);
        Assert.Equal("https://lh3/bb=w544-h544", r[0].Art);
    }

    [Fact]
    public void CountryComesFromTheSystemLanguageWithSpainAsFallback()
    {
        Assert.Equal("MX", YouTubeMusic.UserCountry(["es-MX", "en-US"]));
        Assert.Equal("AR", YouTubeMusic.UserCountry(["es_AR"]));
        Assert.Equal("ES", YouTubeMusic.UserCountry(["es", "en"]));
        Assert.Equal("ES", YouTubeMusic.UserCountry(null));
    }

    [Fact]
    public void BrowseBodyCarriesTheCountryOnlyWhenValid()
    {
        using var mx = JsonDocument.Parse(YouTubeMusic.BrowseBody("FEmusic_charts", "MX"));
        Assert.Equal("MX", mx.RootElement.GetProperty("formData").GetProperty("selectedValues")[0].GetString());
        using var none = JsonDocument.Parse(YouTubeMusic.BrowseBody("MPREb_NMmY1n1NJFS"));
        Assert.False(none.RootElement.TryGetProperty("formData", out _));
        using var bad = JsonDocument.Parse(YouTubeMusic.BrowseBody("MPREb_NMmY1n1NJFS", "xx"));
        Assert.False(bad.RootElement.TryGetProperty("formData", out _));
    }

    [Fact]
    public void CountryNamesAndTheOfficialHitsList()
    {
        Assert.Equal("Colombia", YouTubeMusic.CountryName("CO"));
        Assert.Equal("España", YouTubeMusic.CountryName("es"));
        Assert.Equal("ZZ", YouTubeMusic.CountryName("ZZ"));
        var json = "{\"x\":[" + Two("VLOLAK5uy_kcnWWQfQbentpiyNPEME69IkaOUqsq4Jw", "Las 20 tendencias en Colombia") + ","
            + Two("VLPL4fGSI1pDJn6J8V3F1Nfgigbyrhd2fhgI", "Top diario de vídeos musicales en Colombia") + ","
            + Two("VLPL4fGSI1pDJn4ObZYxzctc1AM45GSWm2DC", "Los 100 vídeos musicales más populares en Colombia") + ","
            + Two("MPREb_AAAA1111bbbb", "Un álbum") + "]}";
        var lists = YouTubeMusic.ParseChartLists(json);
        Assert.Equal(3, lists.Count);
        Assert.Equal("Los 100 vídeos musicales más populares en Colombia", YouTubeMusic.PickHitsList(lists)!.Title);
        Assert.Equal("Top diario de vídeos musicales en Colombia", YouTubeMusic.PickHitsList(lists.Take(2).ToList())!.Title);
        Assert.Equal("Las 20 tendencias en Colombia", YouTubeMusic.PickHitsList(lists.Take(1).ToList())!.Title);
        Assert.Null(YouTubeMusic.PickHitsList([]));
    }

    [Fact]
    public void VideoShelvesByCountryRenewWeeklyAndKeepSpainClassics()
    {
        var co = YouTubeMusic.ShelvesFor("CO", "Colombia");
        var es = YouTubeMusic.ShelvesFor("ES", "España");
        Assert.Equal(8, co.Count);
        Assert.Contains("Colombia", co[0].Title);
        Assert.True(co.Count(s => s.Queries.Any(q => q.Week)) >= 5, "varias estanterías se renuevan cada semana");
        Assert.All(co, s => Assert.All(s.Queries, q => Assert.True(q.Q.Trim().Length > 3)));
        Assert.Contains(es.First(s => s.Title == "Eventos del año").Queries, q => q.Q.Contains("Velada"));
        Assert.Contains(es.First(s => s.Title == "YouTubers").Queries, q => q.Q == "Ibai");
        Assert.DoesNotContain(co.First(s => s.Title == "YouTubers").Queries, q => q.Q == "Ibai");
        Assert.All(YouTubeMusic.ShelvesFor("MX", ""), s => Assert.NotEmpty(s.Queries));
    }
}
