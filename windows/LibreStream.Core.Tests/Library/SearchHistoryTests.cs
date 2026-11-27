using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public sealed class SearchHistoryTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("ns-busquedas-").FullName;

    public void Dispose() => Directory.Delete(_dir, true);

    [Fact]
    public void KeepsTheNewestFirstAndRemembersThem()
    {
        var history = new SearchHistory(_dir);
        history.Add("quevedo");
        history.Add("  bad bunny  ");
        Assert.Equal(["bad bunny", "quevedo"], history.Items);
        Assert.Equal(["bad bunny", "quevedo"], new SearchHistory(_dir).Items);
    }

    [Fact]
    public void RepeatingASearchMovesItUpWithoutDuplicatingIt()
    {
        var history = new SearchHistory(_dir);
        history.Add("Rosalía");
        history.Add("aitana");
        history.Add("rosalia");
        Assert.Equal(["rosalia", "aitana"], history.Items);
    }

    [Fact]
    public void KeepsOnlyTheLastTen()
    {
        var history = new SearchHistory(_dir);
        for (var i = 1; i <= 15; i++) history.Add($"canción {i}");
        Assert.Equal(SearchHistory.Max, history.Items.Count);
        Assert.Equal("canción 15", history.Items[0]);
        Assert.Equal("canción 6", history.Items[^1]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a")]
    [InlineData("¿?")]
    public void IgnoresWhatIsNotASearch(string? query)
    {
        var history = new SearchHistory(_dir);
        history.Add(query);
        Assert.Empty(history.Items);
    }

    [Fact]
    public void CutsVeryLongText()
    {
        var history = new SearchHistory(_dir);
        history.Add(new string('x', 500));
        Assert.Equal(100, history.Items[0].Length);
    }

    [Fact]
    public void SuggestsTheOnesThatContainWhatIsBeingTyped()
    {
        var history = new SearchHistory(_dir);
        history.Add("Rosalía despechá");
        history.Add("rosa");
        history.Add("quevedo");
        Assert.Equal(["quevedo", "rosa", "Rosalía despechá"], history.Matching(" "));
        Assert.Equal(["Rosalía despechá"], history.Matching("ROSA"));   // la idéntica no se sugiere
        Assert.Empty(history.Matching("shakira"));
    }

    [Fact]
    public void ClearingIsRemembered()
    {
        var history = new SearchHistory(_dir);
        history.Add("quevedo");
        history.Clear();
        Assert.Empty(history.Items);
        Assert.Empty(new SearchHistory(_dir).Items);
    }

    [Theory]
    [InlineData("{ roto")]
    [InlineData("{\"a\": 1}")]
    [InlineData("null")]
    public void ADamagedFileStartsEmpty(string content)
    {
        File.WriteAllText(Path.Combine(_dir, "searches.json"), content);
        var history = new SearchHistory(_dir);
        Assert.Empty(history.Items);
        history.Add("quevedo");
        Assert.Single(new SearchHistory(_dir).Items);
    }

    [Fact]
    public void BadEntriesInTheFileAreSkipped()
    {
        File.WriteAllText(Path.Combine(_dir, "searches.json"), """["quevedo", null, "", "a", "aitana"]""");
        Assert.Equal(["quevedo", "aitana"], new SearchHistory(_dir).Items);
    }
}
