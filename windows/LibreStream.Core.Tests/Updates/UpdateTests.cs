using System.Text.Json;
using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class ReleaseVersionTests
{
    [Fact]
    public void OrdersEveryReleaseStep()
    {
        string[] ordered = ["0.7.9", "0.8.0-alpha", "0.8.0-beta.2", "0.8.0-beta.9", "0.8.0-beta.10", "0.8.0-beta.11", "0.8.0-rc.1",
            "0.8.0", "0.8.1-beta.1", "0.8.10", "0.9.0-beta.1", "0.10.0", "1.0.0"];
        for (var i = 0; i < ordered.Length; i++)
            for (var j = 0; j < ordered.Length; j++)
                Assert.True(Math.Sign(ReleaseVersion.Parse(ordered[i])!.CompareTo(ReleaseVersion.Parse(ordered[j]))) == Math.Sign(i.CompareTo(j)),
                    $"{ordered[i]} frente a {ordered[j]}");
    }

    [Theory]
    [InlineData("v0.8.0-beta.11", "0.8.0-beta.11")]
    [InlineData("0.8.0-beta.11+eb2bc0d1f", "0.8.0-beta.11")]
    [InlineData(" 1.2.3 ", "1.2.3")]
    public void IgnoresPrefixAndBuildData(string text, string expected) => Assert.Equal(expected, ReleaseVersion.Parse(text)!.Text);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("dev-eb2bc0d")]
    [InlineData("0.8")]
    [InlineData("0.8.0.11")]
    [InlineData("0.8.0-")]
    [InlineData("0.8.0-beta.11/../x")]
    [InlineData("99999999999.0.0")]
    public void RejectsWhatIsNotAVersion(string? text) => Assert.Null(ReleaseVersion.Parse(text));

    [Fact]
    public void KnowsDevelopmentBuilds()
    {
        Assert.True(ReleaseVersion.Parse("0.0.0-dev+abc1234")!.IsDevelopment);
        Assert.False(ReleaseVersion.Parse("0.8.0-beta.11")!.IsDevelopment);
    }
}

public sealed class UpdateCheckerTests : IDisposable
{
    private const string Suffix = "-windows-x64.zip";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "ns-updates-" + Guid.NewGuid().ToString("N"));
    private DateTimeOffset _now = new(2026, 11, 28, 10, 0, 0, TimeSpan.Zero);
    private int _requests;
    private string? _response;

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    private static object Release(string tag, bool draft = false, string suffix = Suffix, string state = "uploaded") => new
    {
        tag_name = tag, draft, prerelease = tag.Contains('-'), html_url = "https://example.test/otra",
        assets = new[] { new { name = $"Nsound-{tag.TrimStart('v')}{suffix}", state } },
    };

    private static string Json(params object[] releases) => JsonSerializer.Serialize(releases);

    private UpdateChecker Checker(string? installed = "0.8.0-beta.11") => new(_dir, installed, Suffix, () =>
    {
        _requests++;
        return _response is null ? Task.FromException<string>(new HttpRequestException("sin red")) : Task.FromResult(_response);
    }, () => _now);

    [Fact]
    public void PicksTheHighestPublishedReleaseWithThisPlatformsFile()
    {
        var json = Json(
            Release("v0.8.0-beta.12"), Release("v0.8.0-beta.13"), Release("v0.8.0-beta.9"),
            Release("v0.9.0", draft: true),
            Release("v0.8.0-beta.15", suffix: "-android.apk"),     // la de Windows aún no está subida
            Release("v0.8.0-beta.16", state: "open"),
            Release("experimento"));
        Assert.Equal("v0.8.0-beta.13", UpdateChecker.LatestTag(json, Suffix));
        Assert.Null(UpdateChecker.LatestTag("[]", Suffix));
        Assert.Null(UpdateChecker.LatestTag("""[1, {"tag_name": 5}, {"tag_name": "v9.0.0", "assets": "no"}]""", Suffix));
        Assert.Throws<JsonException>(() => UpdateChecker.LatestTag("""{"message": "API rate limit exceeded"}""", Suffix));
    }

    [Fact]
    public async Task AnnouncesANewerVersionWithItsReleasePage()
    {
        _response = Json(Release("v0.8.0-beta.12"));
        var update = await Checker().CheckAsync();
        Assert.Equal(new AvailableUpdate("0.8.0-beta.12", "https://github.com/N1x0321/Nsound/releases/tag/v0.8.0-beta.12"), update);
    }

    [Theory]
    [InlineData("v0.8.0-beta.11")]
    [InlineData("v0.8.0-beta.10")]
    public async Task SaysNothingWhenUpToDate(string published)
    {
        _response = Json(Release(published));
        Assert.Null(await Checker().CheckAsync());
    }

    [Theory]
    [InlineData("0.0.0-dev")]
    [InlineData("")]
    [InlineData(null)]
    public async Task DevelopmentBuildsNeverAsk(string? installed)
    {
        _response = Json(Release("v0.8.0-beta.12"));
        Assert.Null(await Checker(installed).CheckAsync());
        Assert.Equal(0, _requests);
    }

    [Fact]
    public async Task AsksAtMostOnceADayAndRemembersTheAnswer()
    {
        _response = Json(Release("v0.8.0-beta.12"));
        await Checker().CheckAsync();
        _now = _now.AddHours(23);
        var restarted = Checker();
        Assert.Equal("0.8.0-beta.12", restarted.Current?.Version);
        Assert.Equal("0.8.0-beta.12", (await restarted.CheckAsync())?.Version);
        Assert.Equal(1, _requests);
        _now = _now.AddHours(2);
        _response = Json(Release("v0.8.0-beta.13"));
        Assert.Equal("0.8.0-beta.13", (await restarted.CheckAsync())?.Version);
        Assert.Equal(2, _requests);
    }

    [Fact]
    public async Task TheNoticeDisappearsAfterUpdating()
    {
        _response = Json(Release("v0.8.0-beta.12"));
        await Checker().CheckAsync();
        Assert.Null(Checker("0.8.0-beta.12").Current);
    }

    [Fact]
    public async Task NetworkAndFormatErrorsAreSilentAndCountAsTheDaysAttempt()
    {
        Assert.Null(await Checker().CheckAsync());
        _response = Json(Release("v0.8.0-beta.12"));
        Assert.Null(await Checker().CheckAsync());
        Assert.Equal(1, _requests);
        _now = _now.AddDays(1);
        Assert.NotNull(await Checker().CheckAsync());
        _now = _now.AddDays(1);
        _response = "<html>error</html>";
        Assert.Equal("0.8.0-beta.12", (await Checker().CheckAsync())?.Version);   // conserva lo último que supo
    }

    [Fact]
    public async Task ADismissedVersionStaysHiddenButTheNextOneShows()
    {
        _response = Json(Release("v0.8.0-beta.12"));
        var checker = Checker();
        checker.Dismiss((await checker.CheckAsync())!.Version);
        Assert.Null(checker.Current);
        Assert.Null(Checker().Current);
        _now = _now.AddDays(1);
        _response = Json(Release("v0.8.0-beta.13"), Release("v0.8.0-beta.12"));
        Assert.Equal("0.8.0-beta.13", (await Checker().CheckAsync())?.Version);
    }

    [Fact]
    public async Task ABrokenStateFileOrAClockSetBackDoNotBlockTheCheck()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(Path.Combine(_dir, "updates.json"), "{roto");
        _response = Json(Release("v0.8.0-beta.12"));
        Assert.NotNull(await Checker().CheckAsync());
        _now = _now.AddDays(-30);
        await Checker().CheckAsync();
        Assert.Equal(2, _requests);
    }
}
