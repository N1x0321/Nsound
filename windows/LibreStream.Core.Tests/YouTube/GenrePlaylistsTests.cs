using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class GenrePlaylistsTests
{
    private static ChartList L(string id, string title) => new(id, title);

    [Fact]
    public void EveryAppGenreExceptHitsHasASource()
    {
        foreach (var g in new[] { "Reggaetón", "Pop", "Rock", "Electrónica", "Hip hop", "Latino", "Lo-fi" })
            Assert.NotNull(YouTubeMusic.GenreSource(g));
        Assert.Null(YouTubeMusic.GenreSource("Éxitos"));   // Éxitos va por la lista oficial del país
    }

    [Fact]
    public void ParsesMoodCategories()
    {
        var json = "{\"x\":[{\"musicNavigationButtonRenderer\":{\"buttonText\":{\"runs\":[{\"text\":\"Dance y electrónica\"}]},"
            + "\"clickCommand\":{\"browseEndpoint\":{\"browseId\":\"FEmusic_moods_and_genres_category\",\"params\":\"ggMPabc\"}}}},"
            + "{\"musicNavigationButtonRenderer\":{\"buttonText\":{\"runs\":[{\"text\":\"Otra cosa\"}]},\"clickCommand\":{\"browseEndpoint\":{\"browseId\":\"FEotro\"}}}}]}";
        var cats = YouTubeMusic.ParseMoodCategories(json);
        Assert.Single(cats);
        Assert.Equal("ggMPabc", YouTubeMusic.FindCategory(cats, "dance y electronica")!.Params);
        Assert.Null(YouTubeMusic.FindCategory(cats, "Jazz"));
        Assert.Empty(YouTubeMusic.ParseMoodCategories("no es json"));
    }

    [Fact]
    public void PicksTheCurrentOfficialListNotClassicsOrCommunity()
    {
        var dance = new[]
        {
            L("VLRDCLAK5uy_billion", "Billion Views Club - EDM"),
            L("VLPLcomunidad", "Éxitos actuales del dance de un usuario"),
            L("VLRDCLAK5uy_actual", "Éxitos actuales del dance"),
            L("VLRDCLAK5uy_hits", "Dance Hits"),
        };
        Assert.Equal("VLRDCLAK5uy_actual", YouTubeMusic.PickGenrePlaylist(dance, YouTubeMusic.GenreSource("Electrónica")!.Value.Prefer)!.Id);

        var rock = new[] { L("VLRDCLAK5uy_a", "Rock clásico para sentirse bien"), L("VLRDCLAK5uy_b", "Grandes clásicos del rock"), L("VLRDCLAK5uy_c", "Maximum Decibels: Today's Rock Hits") };
        Assert.Equal("VLRDCLAK5uy_c", YouTubeMusic.PickGenrePlaylist(rock, YouTubeMusic.GenreSource("Rock")!.Value.Prefer)!.Id);

        var latin = new[] { L("VLRDCLAK5uy_1", "Latin Now"), L("VLRDCLAK5uy_2", "Hot Reggaeton") };
        Assert.Equal("VLRDCLAK5uy_2", YouTubeMusic.PickGenrePlaylist(latin, YouTubeMusic.GenreSource("Reggaetón")!.Value.Prefer)!.Id);
        Assert.Equal("VLRDCLAK5uy_1", YouTubeMusic.PickGenrePlaylist(latin, YouTubeMusic.GenreSource("Latino")!.Value.Prefer)!.Id);
    }

    [Fact]
    public void FallsBackToAnyCurrentOfficialList()
    {
        var lists = new[] { L("VLRDCLAK5uy_old", "Hip hop de los 2000"), L("VLRDCLAK5uy_new", "Street Bangers"), L("VLPLx", "De la comunidad") };
        Assert.Equal("VLRDCLAK5uy_new", YouTubeMusic.PickGenrePlaylist(lists, ["nada que coincida"])!.Id);
        Assert.Null(YouTubeMusic.PickGenrePlaylist([L("VLPLx", "Solo comunidad")], ["x"]));
    }

    [Fact]
    public void CountryArtistsGoFirstInRankingOrder()
    {
        YouTubeVideo V(string id, string channel) => new(id, "t" + id, channel, 200);
        var songs = new[] { V("1", "Shakira"), V("2", "Blessd · Álbum"), V("3", "Quevedo"), V("4", "Ryan Castro y Blessd"), V("5", "Otro") };
        var colombia = new[] { "Ryan Castro", "Blessd", "Feid" };
        Assert.Equal(["4", "2", "1", "3", "5"], YouTubeMusic.BoostByArtists(songs, colombia).Select(v => v.Id));
        Assert.Equal(["1", "2", "3", "4", "5"], YouTubeMusic.BoostByArtists(songs, []).Select(v => v.Id));
    }
}
