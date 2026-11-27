using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class WeekSummaryTests
{
    private static readonly DateTime Now = new(2026, 11, 24, 18, 0, 0);

    private static PlayRecord P(string id, string artist, double daysAgo, double seconds = 180)
        => new(new SavedItem("youtube", id, "Canción " + id, artist, seconds, null), artist, Now.AddDays(-daysAgo));

    [Fact]
    public void CountsOnlyTheLastSevenDays()
    {
        var w = WeekSummary.Build([P("a", "X", 0), P("b", "Y", 6.5), P("c", "Z", 7.9), P("d", "Z", 20)], Now);
        Assert.Equal(new DateTime(2026, 11, 18), w.From);
        Assert.Equal(2, w.Plays);            // hace 6,5 días aún es dentro (día 18); hace 7,9 días ya no
        Assert.Equal(6, w.Minutes, 3);       // 2 × 3 min
        Assert.Equal(3, w.PreviousMinutes, 3);
        Assert.Equal(1.0, w.Change!.Value, 3);   // el doble que la semana anterior
    }

    [Fact]
    public void TopArtistsAndSongs()
    {
        var w = WeekSummary.Build(
        [
            P("bb1", "Bad Bunny", 0), P("bb2", "Bad Bunny", 1), P("bb1", "BAD BUNNY", 2),
            P("f1", "Feid", 1), P("f1", "Feid", 3), P("f1", "Feid", 4), P("f2", "Feid", 4),
            P("q1", "Quevedo", 2),
        ], Now, top: 2);
        Assert.Equal(["Feid", "Bad Bunny"], w.TopArtists.Select(a => a.Artist));
        Assert.Equal(4, w.TopArtists[0].Plays);
        Assert.Equal("f1", w.TopArtists[0].TopSong.Id);
        Assert.Equal(["f1", "bb1"], w.TopSongs.Select(s => s.Song.Id));
        Assert.Equal(3, w.TopSongs[0].Plays);
        Assert.Equal(3, w.Artists);
        Assert.Equal(5, w.Songs);
    }

    [Fact]
    public void MinutesByDayOldestFirstWithLongMixesCapped()
    {
        var w = WeekSummary.Build([P("a", "X", 0, 120), P("b", "X", 0, 3600), P("c", "X", 6, 60)], Now);
        Assert.Equal(7, w.MinutesByDay.Count);
        Assert.Equal(new DateTime(2026, 11, 24), w.Days[6]);
        Assert.Equal(12, w.MinutesByDay[6], 3);   // 2 min + una mezcla de 1 h contada como 10 min
        Assert.Equal(1, w.MinutesByDay[0], 3);
        Assert.Equal(0, w.MinutesByDay[3]);
    }

    [Fact]
    public void EmptyHistory()
    {
        var w = WeekSummary.Build([], Now);
        Assert.True(w.IsEmpty);
        Assert.Null(w.Change);
        Assert.Empty(w.TopArtists);
    }
}
