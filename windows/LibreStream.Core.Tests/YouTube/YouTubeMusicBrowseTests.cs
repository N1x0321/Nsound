using System.Text.Json;
using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class YouTubeMusicBrowseTests
{
    private const string Cover = "https://lh3.googleusercontent.com/abc=w226-h226-l90-rj";
    private const string Cover544 = "https://lh3.googleusercontent.com/abc=w544-h544";
    private const string ArtistId = "UCiMhD4jzUqG-IgPzUmmytRQ";

    private static string Cols(params string[][] cols) => string.Join(",", cols.Select(c =>
        "{\"musicResponsiveListItemFlexColumnRenderer\":{\"text\":{\"runs\":[" + string.Join(",{\"text\":\" • \"},", c.Select(p => "{\"text\":" + JsonSerializer.Serialize(p) + "}")) + "]}}}"));

    private static string Thumb(string url) => "\"thumbnail\":{\"musicThumbnailRenderer\":{\"thumbnail\":{\"thumbnails\":[{\"url\":\"https://lh3.googleusercontent.com/x=w60-h60\"},{\"url\":\"" + url + "\"}]}}}";

    private static string AlbumRow(string id, string title, string[] sub, string art = Cover)
        => "{\"musicResponsiveListItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"" + id + "\"}}," + Thumb(art) + ",\"flexColumns\":[" + Cols([title], sub) + "]}}";

    [Fact]
    public void FiltersUseTheSameParamsAsTheWebApp()
    {
        Assert.Equal("EgWKAQIYAWoMEA4QChADEAQQCRAF", YouTubeMusic.AlbumsFilter);
        Assert.Equal("EgWKAQIgAWoMEA4QChADEAQQCRAF", YouTubeMusic.ArtistsFilter);
        using var doc = JsonDocument.Parse(YouTubeMusic.SearchBody(" queen ", YouTubeMusic.AlbumsFilter));
        Assert.Equal("queen", doc.RootElement.GetProperty("query").GetString());
        Assert.Equal(YouTubeMusic.AlbumsFilter, doc.RootElement.GetProperty("params").GetString());
        using var b = JsonDocument.Parse(YouTubeMusic.BrowseBody("MPREb_abc123"));
        Assert.Equal("MPREb_abc123", b.RootElement.GetProperty("browseId").GetString());
        Assert.Equal("WEB_REMIX", b.RootElement.GetProperty("context").GetProperty("client").GetProperty("clientName").GetString());
    }

    [Fact]
    public void ParsesAlbumsWithKindArtistYearAndArt()
    {
        var json = "{\"contents\":[" + AlbumRow("MPREb_abcDEF123", "A Night At The Opera", ["Álbum", "Queen", "1975"]) + ","
            + AlbumRow("MPREb_sencillo1", "Single suelto", ["Sencillo", "Queen"]) + ","
            + AlbumRow("MPREb_abcDEF123", "Repetido", ["Álbum", "Queen", "1975"]) + ","
            + AlbumRow(ArtistId, "No es un álbum", ["Artista"]) + "]}";
        var albums = YouTubeMusic.ParseAlbums(json);
        Assert.Equal(2, albums.Count);
        Assert.Equal(new MusicAlbum("MPREb_abcDEF123", "A Night At The Opera", "Álbum", "Queen", "1975", Cover544), albums[0]);
        Assert.Equal("Sencillo", albums[1].Kind);
        Assert.Equal("", albums[1].Year);
    }

    [Fact]
    public void ParsesArtistsAndIgnoresAlbums()
    {
        var row = "{\"musicResponsiveListItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"" + ArtistId + "\"}}," + Thumb(Cover)
            + ",\"flexColumns\":[" + Cols(["Queen"], ["Artista", "50 M de suscriptores"]) + "]}}";
        var artists = YouTubeMusic.ParseArtists("{\"c\":[" + row + "," + row + "," + AlbumRow("MPREb_abcDEF123", "Disco", ["Álbum"]) + "]}");
        Assert.Equal([new MusicArtist(ArtistId, "Queen", Cover544)], artists);
    }

    private static string TrackRow(string videoId, string title, string[] sub, string? duration, string? art = null)
        => "{\"musicResponsiveListItemRenderer\":{\"playlistItemData\":{\"videoId\":\"" + videoId + "\"}" + (art is null ? "" : "," + Thumb(art))
            + ",\"flexColumns\":[" + Cols([title], sub) + "]"
            + (duration is null ? "" : ",\"fixedColumns\":[{\"musicResponsiveListItemFixedColumnRenderer\":{\"text\":{\"runs\":[{\"text\":\"" + duration + "\"}]}}}]") + "}}";

    [Fact]
    public void ParsesAlbumTracksUsingTheContext()
    {
        var json = "{\"shelf\":{\"contents\":[" + TrackRow("BSTsnWoslP4", "Bohemian Rhapsody", ["1.2 M reproducciones"], "5:55") + ","
            + TrackRow("2iyV1rsnCzQ", "Love of My Life", ["Queen"], "3:39", Cover) + ","
            + TrackRow("malo", "Id inválido", ["Queen"], "1:00") + ","
            + TrackRow("BSTsnWoslP4", "Repetida", ["Queen"], "5:55") + "]}}";
        var tracks = YouTubeMusic.ParseTracks(json, "Queen", "A Night At The Opera", Cover544);
        Assert.Equal(2, tracks.Count);
        Assert.Equal(new YouTubeVideo("BSTsnWoslP4", "Bohemian Rhapsody", "Queen · A Night At The Opera", 355, null, Cover544), tracks[0]);   // artista y portada del contexto
        Assert.Equal("Queen · A Night At The Opera", tracks[1].Channel);
        Assert.Equal(219, tracks[1].DurationSec);
        Assert.Equal(Cover544, tracks[1].Thumbnail.AbsoluteUri);
    }

    [Fact]
    public void TracksFallBackToTheOverlayVideoIdAndInlineDuration()
    {
        var row = "{\"musicResponsiveListItemRenderer\":{\"overlay\":{\"musicItemThumbnailOverlayRenderer\":{\"content\":{\"musicPlayButtonRenderer\":{\"playNavigationEndpoint\":{\"watchEndpoint\":{\"videoId\":\"2iyV1rsnCzQ\"}}}}}},"
            + "\"flexColumns\":[" + Cols(["Tema"], ["Banda", "Disco", "2:05"]) + "]}}";
        var tracks = YouTubeMusic.ParseTracks("{\"x\":[" + row + "]}");
        var t = Assert.Single(tracks);
        Assert.Equal("Banda · Disco", t.Channel);
        Assert.Equal(125, t.DurationSec);
    }

    [Fact]
    public void ParsesArtistPageSongsAllSongsListAndReleases()
    {
        var release = (string id, string title, string[] sub) => "{\"musicTwoRowItemRenderer\":{\"navigationEndpoint\":{\"browseEndpoint\":{\"browseId\":\"" + id + "\"}},"
            + "\"title\":{\"runs\":[{\"text\":" + JsonSerializer.Serialize(title) + "}]},\"subtitle\":{\"runs\":[" + string.Join(",{\"text\":\" • \"},", sub.Select(s => "{\"text\":\"" + s + "\"}")) + "]},"
            + "\"thumbnailRenderer\":{\"musicThumbnailRenderer\":{\"thumbnail\":{\"thumbnails\":[{\"url\":\"" + Cover + "\"}]}}}}}";
        var json = "{\"contents\":[{\"musicShelfRenderer\":{\"bottomEndpoint\":{\"browseEndpoint\":{\"browseId\":\"VLOLAK5uy_abcdefg\"}},\"contents\":["
            + TrackRow("BSTsnWoslP4", "Bohemian Rhapsody", ["Queen", "A Night At The Opera", "5:55"], null) + "]}},"
            + "{\"musicCarouselShelfRenderer\":{\"contents\":[" + release("MPREb_abcDEF123", "A Night At The Opera", ["Álbum", "1975"]) + ","
            + release("MPREb_ep000001", "Un EP", ["EP", "2001"]) + "," + release("MPREb_abcDEF123", "Repetido", ["Álbum", "1975"]) + "]}}]}";
        var page = YouTubeMusic.ParseArtistPage(json, "Queen");
        Assert.Equal("VLOLAK5uy_abcdefg", page.AllSongsId);
        Assert.Equal("BSTsnWoslP4", Assert.Single(page.Songs).Id);
        Assert.Equal(2, page.Releases.Count);
        Assert.Equal(new MusicAlbum("MPREb_abcDEF123", "A Night At The Opera", "Álbum", "Queen", "1975", Cover544), page.Releases[0]);
        Assert.Equal("EP", page.Releases[1].Kind);
    }

    [Fact]
    public void PicksTheBestAlbumByTitleAndArtist()
    {
        var albums = new List<MusicAlbum>
        {
            new("MPREb_aaaaaa", "Greatest Hits", "Álbum", "Otro Grupo", "2000", null),
            new("MPREb_bbbbbb", "Greatest Hits II", "Álbum", "Queen", "1991", null),
            new("MPREb_cccccc", "Greatest Hits", "Álbum", "Queen", "1981", null),
        };
        Assert.Equal("MPREb_cccccc", YouTubeMusic.PickAlbum(albums, "Greatest Hits", "Queen")?.Id);
        Assert.Equal("MPREb_bbbbbb", YouTubeMusic.PickAlbum(albums, "Hits II", "queen")?.Id);
        Assert.Null(YouTubeMusic.PickAlbum(albums, "Nada que ver", "Queen"));
    }

    [Fact]
    public void BadResponsesGiveNothing()
    {
        Assert.Empty(YouTubeMusic.ParseAlbums("{ roto"));
        Assert.Empty(YouTubeMusic.ParseArtists("{}"));
        Assert.Empty(YouTubeMusic.ParseTracks(""));
        var page = YouTubeMusic.ParseArtistPage("{ roto");
        Assert.Empty(page.Songs);
        Assert.Empty(page.Releases);
    }
}
