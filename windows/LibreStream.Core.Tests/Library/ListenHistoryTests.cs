using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class ListenHistoryTests
{
    private static readonly DateTime Now = new(2026, 11, 24, 18, 0, 0);

    private static PlayRecord P(string id, string artist, double daysAgo, string? title = null)
        => new(new SavedItem("youtube", id, title ?? "Canción " + id, artist, 200, null), artist, Now.AddDays(-daysAgo));

    [Fact]
    public void CountsAfterThirtySecondsOrHalf()
    {
        Assert.Equal(30, ListenHistory.CountsAfter(200));
        Assert.Equal(10, ListenHistory.CountsAfter(20));
        Assert.Equal(30, ListenHistory.CountsAfter(0));   // directo o duración desconocida
    }

    [Fact]
    public void RecentIsDistinctAndNewestFirst()
    {
        var e = new[] { P("a", "X", 0), P("b", "Y", 1), P("a", "X", 2), P("c", "Z", 3) };
        Assert.Equal(["a", "b", "c"], ListenHistory.RecentDistinct(e, 10).Select(i => i.Id));
        Assert.Single(ListenHistory.RecentDistinct(e, 1));
    }

    [Fact]
    public void TopArtistsCountTogetherIgnoringAccentsAndCase()
    {
        var e = new[] { P("a", "Rosalía", 1), P("b", "ROSALIA", 2), P("c", "Feid", 1), P("d", "Rosalía", 40) };
        var top = ListenHistory.TopArtists(e, Now.AddDays(-30), 5);
        Assert.Equal("Rosalía", top[0].Artist);
        Assert.Equal(2, top[0].Plays);
        Assert.Equal(("Feid", 1), top[1]);
    }

    [Fact]
    public void MixesUseFavouriteArtistsThenRecentSongs()
    {
        var e = new[]
        {
            P("n1", "Nuevo", 0, "Recién"),
            P("bb1", "Bad Bunny", 1), P("bb2", "Bad Bunny", 2), P("bb1", "Bad Bunny", 3),
            P("f1", "Feid", 1), P("f1", "Feid", 4),
            P("o1", "Otro", 5, "Vieja"),
            P("q1", "Quevedo", 60), P("q1", "Quevedo", 61),   // hace más de 30 días: no cuenta para «Mezcla de»
        };
        var m = ListenHistory.Mixes(e, Now);
        Assert.Equal(["Mezcla de Bad Bunny", "Mezcla de Feid", "Porque escuchaste «Recién»", "Porque escuchaste «Vieja»"], m.Select(x => x.Title));
        Assert.Equal("bb1", m[0].Seed.Id);   // la más escuchada del artista
        Assert.Empty(ListenHistory.Mixes([], Now));
    }

    [Fact]
    public void InterleaveAlternatesWithoutRepeats()
    {
        IReadOnlyList<IReadOnlyList<string>> lists = [["a1", "a2", "x"], ["b1", "x", "b2", "b3"]];
        Assert.Equal(["a1", "b1", "a2", "x", "b2", "b3"], ListenHistory.Interleave(lists, s => s, [], 10));
        Assert.Equal(["b1", "a2"], ListenHistory.Interleave(lists, s => s, ["a1"], 2));
    }

    [Fact]
    public void SavesAndLoadsAndKeepsTheLimit()
    {
        var dir = Path.Combine(Path.GetTempPath(), "nsound-hist-" + Guid.NewGuid());
        try
        {
            var h = new ListenHistory(dir, max: 20);
            for (var i = 0; i < 25; i++) h.Add(P("id" + i, "X", 0));
            var again = new ListenHistory(dir);
            Assert.Equal(20, again.Entries.Count);
            Assert.Equal("id24", again.Entries[0].Item.Id);
            Assert.Equal("X", again.Entries[0].Artist);
        }
        finally { Directory.Delete(dir, true); }
    }
}
