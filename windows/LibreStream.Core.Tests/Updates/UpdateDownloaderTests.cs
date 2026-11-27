using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class UpdateAssetsTests
{
    [Theory]
    [InlineData(Architecture.X64, "x64")]
    [InlineData(Architecture.Arm64, "arm64")]
    [InlineData(Architecture.X86, "x86")]
    [InlineData(Architecture.Arm, null)]
    public void NamesEachPublishedArchitecture(Architecture architecture, string? expected) =>
        Assert.Equal(expected, UpdateAssets.ArchName(architecture));

    [Theory]
    [InlineData("x64")]
    [InlineData("arm64")]
    [InlineData("x86")]
    public void EachArchitectureOnlyPicksItsOwnSetupAndZip(string arch)
    {
        Assert.Equal($"Nsound-0.8.0-beta.12-windows-{arch}-setup.exe", UpdateAssets.SetupName("0.8.0-beta.12", arch));

        // Una Release por arquitectura, cada una con una versión distinta: así se ve cuál se elige
        var releases = new[] { ("x64", "v0.9.1"), ("arm64", "v0.9.2"), ("x86", "v0.9.3") }.Select(r => new
        {
            tag_name = r.Item2, draft = false,
            assets = new[] { new { name = UpdateAssets.SetupName(r.Item2[1..], r.Item1), state = "uploaded" } },
        });
        var json = JsonSerializer.Serialize(releases);
        var expected = arch switch { "x64" => "v0.9.1", "arm64" => "v0.9.2", _ => "v0.9.3" };
        Assert.Equal(expected, UpdateChecker.LatestTag(json, UpdateAssets.SetupSuffix(arch)));
        Assert.Null(UpdateChecker.LatestTag(json, UpdateAssets.ZipSuffix(arch)));   // el zip no cuenta como instalador ni al revés
    }

    [Fact]
    public void TheNoticeKnowsItsTag() =>
        Assert.Equal("v0.8.0-beta.12", new AvailableUpdate("0.8.0-beta.12", "https://github.com/N1x0321/Nsound/releases/tag/v0.8.0-beta.12").Tag);

    [Fact]
    public void BuildsAnAllowedDownloadUrl()
    {
        var url = UpdateAssets.DownloadUrl("v0.8.0-beta.12", "Nsound-0.8.0-beta.12-windows-x64-setup.exe");
        Assert.Equal("https://github.com/N1x0321/Nsound/releases/download/v0.8.0-beta.12/Nsound-0.8.0-beta.12-windows-x64-setup.exe", url.AbsoluteUri);
        Assert.True(UpdateAssets.IsReleaseUrl(url));
    }

    [Theory]
    [InlineData("http://github.com/N1x0321/Nsound/releases/download/v1.0.0/a.exe")]
    [InlineData("https://github.com:444/N1x0321/Nsound/releases/download/v1.0.0/a.exe")]
    [InlineData("https://usuario@github.com/N1x0321/Nsound/releases/download/v1.0.0/a.exe")]
    [InlineData("https://github.com.example.test/N1x0321/Nsound/releases/download/v1.0.0/a.exe")]
    [InlineData("https://example.test/N1x0321/Nsound/releases/download/v1.0.0/a.exe")]
    [InlineData("https://github.com/otro/Nsound/releases/download/v1.0.0/a.exe")]
    [InlineData("https://github.com/N1x0321/Nsound-falso/releases/download/v1.0.0/a.exe")]
    [InlineData("https://github.com/N1x0321/Nsound/releases/download/../../../../otro/repo/releases/download/v1/a.exe")]
    [InlineData("https://github.com/N1x0321/Nsound/releases/download/v1.0.0/%2e%2e%2f%2e%2e%2fa.exe")]
    [InlineData("https://github.com/N1x0321/Nsound/releases/download/v1.0.0/")]
    [InlineData("https://github.com/N1x0321/Nsound/releases/download/v1.0.0/sub/a.exe")]
    [InlineData("https://github.com/N1x0321/Nsound/releases/tag/v1.0.0")]
    [InlineData("https://github.com/N1x0321/Nsound/archive/main.zip")]
    [InlineData("file:///C:/Windows/System32/calc.exe")]
    public void RejectsAnythingOutsideNsoundsReleases(string url)
    {
        Assert.False(UpdateAssets.IsReleaseUrl(new Uri(url)));
        Assert.False(UpdateAssets.IsAllowedRedirect(new Uri(url)));
    }

    [Theory]
    [InlineData("https://release-assets.githubusercontent.com/github-production-release-asset/1453134198/43e99d6a?sp=r&sig=x", true)]
    [InlineData("https://objects.githubusercontent.com/github-production-release-asset-2e65be/1453134198/43e99d6a?X-Amz=1", true)]
    [InlineData("https://release-assets.githubusercontent.com/github-production-release-asset/999/43e99d6a", false)]   // otro repositorio
    [InlineData("https://objects.githubusercontent.com/github-production-release-asset-2e65be/14531341980/x", false)]
    [InlineData("http://release-assets.githubusercontent.com/github-production-release-asset/1453134198/x", false)]
    [InlineData("https://raw.githubusercontent.com/N1x0321/Nsound/main/a.exe", false)]
    [InlineData("https://release-assets.githubusercontent.com.example.test/github-production-release-asset/1453134198/x", false)]
    public void RedirectsOnlyToThisRepositorysStorage(string url, bool allowed)
    {
        Assert.Equal(allowed, UpdateAssets.IsAllowedRedirect(new Uri(url)));
        Assert.False(UpdateAssets.IsReleaseUrl(new Uri(url)));   // nunca como punto de partida
    }
}

public sealed class InstallKindTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("ns-install-").FullName;

    public void Dispose() => Directory.Delete(_dir, true);

    [Fact]
    public void OnlyTheSetupLeavesItsUninstallerBesideTheApp()
    {
        Assert.False(InstallKind.IsInstalledWithSetup(_dir));                     // zip portable
        File.WriteAllText(Path.Combine(_dir, "unins000.exe"), "");
        Assert.False(InstallKind.IsInstalledWithSetup(_dir));
        File.WriteAllText(Path.Combine(_dir, "unins000.dat"), "");
        Assert.True(InstallKind.IsInstalledWithSetup(_dir));
        Assert.True(InstallKind.IsInstalledWithSetup(_dir + Path.DirectorySeparatorChar));   // como AppContext.BaseDirectory
        Assert.False(InstallKind.IsInstalledWithSetup(Path.Combine(_dir, "no-existe")));
    }
}

public sealed class UpdateDownloaderTests : IDisposable
{
    private const string Tag = "v0.8.0-beta.12", Version = "0.8.0-beta.12";
    private const string Name = "Nsound-0.8.0-beta.12-windows-x64-setup.exe";
    private const string Storage = "https://release-assets.githubusercontent.com/github-production-release-asset/1453134198/";

    private static readonly byte[] Setup = Enumerable.Range(0, 300_000).Select(i => (byte)(i * 31)).ToArray();
    private static readonly string Sha = Convert.ToHexString(SHA256.HashData(Setup)).ToLowerInvariant();

    private readonly string _root = Directory.CreateTempSubdirectory("ns-descarga-").FullName;
    private readonly List<Uri> _requests = [];
    private string Folder => Path.Combine(_root, "updates");
    private string Target => Path.Combine(Folder, Name);

    private string? _checksum = $"{Sha}  {Name}\r\n";
    private byte[] _body = Setup;
    private Func<Uri, HttpResponseMessage?>? _override;

    public void Dispose() => Directory.Delete(_root, true);

    private sealed class Fake(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }

    /// <summary>Como GitHub: la dirección de la Release redirige a su almacén y el almacén da el fichero.</summary>
    private HttpResponseMessage Respond(HttpRequestMessage request)
    {
        var url = request.RequestUri!;
        _requests.Add(url);
        if (_override?.Invoke(url) is { } special) return special;
        var file = url.Segments[^1];
        if (url.Host == "github.com") return file.EndsWith(".sha256") && _checksum is null ? new(HttpStatusCode.NotFound) : Redirect(Storage + file);
        return new(HttpStatusCode.OK) { Content = new ByteArrayContent(file.EndsWith(".sha256") ? Encoding.ASCII.GetBytes(_checksum!) : _body) };
    }

    private static HttpResponseMessage Redirect(string to)
    {
        var response = new HttpResponseMessage(HttpStatusCode.Found);
        response.Headers.Location = new Uri(to, UriKind.RelativeOrAbsolute);
        return response;
    }

    private UpdateDownloader Downloader() => new(Folder, new Fake(Respond));

    private Task<DownloadedUpdate> Download(IProgress<double>? progress = null) => Downloader().DownloadAsync(Tag, Version, "x64", progress);

    private void AssertNothingToRun() => Assert.Empty(Directory.Exists(Folder) ? Directory.GetFiles(Folder) : []);

    private sealed class Progress : IProgress<double>
    {
        public List<double> Values { get; } = [];
        public void Report(double value) => Values.Add(value);
    }

    [Fact]
    public async Task SavesTheSetupWhoseHashMatches()
    {
        var progress = new Progress();
        var update = await Download(progress);
        Assert.Equal(Target, update.Path);
        Assert.Equal(Sha, update.Sha256);
        Assert.Equal(Setup, File.ReadAllBytes(update.Path));
        Assert.Equal([Target], Directory.GetFiles(Folder));
        Assert.Equal(1.0, progress.Values[^1]);
        Assert.Equal(progress.Values.Order(), progress.Values);
        Assert.Equal($"https://github.com/N1x0321/Nsound/releases/download/{Tag}/{Name}.sha256", _requests[0].AbsoluteUri);   // la huella, primero
        using var locked = update.OpenVerified();
        Assert.NotNull(locked);
    }

    [Fact]
    public async Task AWrongHashLeavesNothingToRun()
    {
        _body = [.. Setup, 0];
        var error = await Assert.ThrowsAsync<UpdateException>(() => Download());
        Assert.Contains("no coincide", error.Message);
        AssertNothingToRun();
    }

    [Fact]
    public async Task AMissingHashDownloadsNothing()
    {
        _checksum = null;
        await Assert.ThrowsAsync<UpdateException>(() => Download());
        Assert.Single(_requests);
        AssertNothingToRun();
    }

    [Theory]
    [InlineData("")]
    [InlineData("no es una huella")]
    [InlineData("0123456789abcdef")]
    [InlineData("<html>Not Found</html>")]
    public async Task AnUnreadableHashDownloadsNothing(string checksum)
    {
        _checksum = checksum;
        await Assert.ThrowsAsync<UpdateException>(() => Download());
        Assert.DoesNotContain(_requests, u => u.Segments[^1] == Name);
        AssertNothingToRun();
    }

    [Fact]
    public void ReadsTheChecksumFileOfThatNameOnly()
    {
        Assert.Equal(Sha, UpdateDownloader.ParseChecksum($"{Sha}  {Name}\r\n", Name));
        Assert.Equal(Sha, UpdateDownloader.ParseChecksum($"{(char)0xFEFF}{Sha.ToUpperInvariant()} *{Name}", Name));
        Assert.Equal(Sha, UpdateDownloader.ParseChecksum(Sha + "\n", Name));
        Assert.Null(UpdateDownloader.ParseChecksum($"{Sha}  Nsound-0.8.0-beta.12-windows-arm64-setup.exe", Name));
        Assert.Null(UpdateDownloader.ParseChecksum($"{Sha}  {Name}  más", Name));
        Assert.Null(UpdateDownloader.ParseChecksum($"{Sha[..63]}z  {Name}", Name));
        Assert.Null(UpdateDownloader.ParseChecksum(new string('a', 128), Name));
    }

    [Theory]
    [InlineData("https://example.test/malo.exe")]
    [InlineData("http://release-assets.githubusercontent.com/github-production-release-asset/1453134198/x")]
    [InlineData("https://github.com/otro/repo/releases/download/v1/a.exe")]
    [InlineData("https://release-assets.githubusercontent.com/github-production-release-asset/1/x")]
    public async Task ARedirectElsewhereIsNeverFollowed(string elsewhere)
    {
        _override = url => url.Segments[^1] == Name && url.Host == "github.com" ? Redirect(elsewhere) : null;
        var error = await Assert.ThrowsAsync<UpdateException>(() => Download());
        Assert.Contains("fuera", error.Message);
        Assert.DoesNotContain(new Uri(elsewhere), _requests);
        AssertNothingToRun();
    }

    [Fact]
    public async Task ASecondRedirectIsCheckedToo()
    {
        _override = url => url.Host != "github.com" && url.Segments[^1] == Name ? Redirect("https://example.test/malo.exe") : null;
        await Assert.ThrowsAsync<UpdateException>(() => Download());
        Assert.DoesNotContain(_requests, u => u.Host == "example.test");
        AssertNothingToRun();
    }

    [Fact]
    public async Task AnAnswerFromAnotherAddressIsRejected()
    {
        _override = url => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Setup),
            RequestMessage = new HttpRequestMessage(HttpMethod.Get, "https://example.test/seguida-sin-preguntar"),
        };
        await Assert.ThrowsAsync<UpdateException>(() => Download());
        AssertNothingToRun();
    }

    [Fact]
    public async Task EndlessRedirectsStop()
    {
        _override = url => Redirect(url.AbsoluteUri);
        await Assert.ThrowsAsync<UpdateException>(() => Download());
        Assert.InRange(_requests.Count, 2, 10);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task ServerErrorsBecomeAMessage(HttpStatusCode status)
    {
        _override = url => url.Segments[^1] == Name ? new(status) : null;
        await Assert.ThrowsAsync<UpdateException>(() => Download());
        AssertNothingToRun();
    }

    [Fact]
    public async Task NetworkErrorsBecomeAMessage()
    {
        _override = _ => throw new HttpRequestException("sin red");
        await Assert.ThrowsAsync<UpdateException>(() => Download());
    }

    [Fact]
    public async Task CancellingIsNotAnError()
    {
        using var cancel = new CancellationTokenSource();
        _override = url =>
        {
            if (url.Segments[^1] == Name) cancel.Cancel();
            return null;
        };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Downloader().DownloadAsync(Tag, Version, "x64", null, cancel.Token));
        AssertNothingToRun();
    }

    [Theory]
    [InlineData("v0.8.0-beta.12", "0.8.0-beta.13", "x64")]
    [InlineData("../../otra", "0.8.0-beta.12", "x64")]
    [InlineData("v0.8.0-beta.12+x", "0.8.0-beta.12", "x64")]
    [InlineData("v0.8.0-beta.12", "0.8.0-beta.12", "../x64")]
    public async Task OddVersionsOrArchitecturesAskForNothing(string tag, string version, string arch)
    {
        await Assert.ThrowsAsync<UpdateException>(() => Downloader().DownloadAsync(tag, version, arch));
        Assert.Empty(_requests);
    }

    [Fact]
    public async Task ReusesAGoodDownloadAndReplacesABadOne()
    {
        await Download();
        _requests.Clear();
        await Download();
        Assert.DoesNotContain(_requests, u => u.Segments[^1] == Name);   // ya estaba: solo se vuelve a pedir la huella

        File.WriteAllText(Target, "cambiado");
        Assert.Equal(Setup, File.ReadAllBytes((await Download()).Path));
    }

    [Fact]
    public async Task AChangedFileIsNotOpenedForRunning()
    {
        var update = await Download();
        using (var locked = update.OpenVerified())
        {
            Assert.NotNull(locked);
            if (OperatingSystem.IsWindows()) Assert.Throws<IOException>(() => File.WriteAllText(update.Path, "otro"));
        }
        File.AppendAllText(update.Path, "x");
        Assert.Null(update.OpenVerified());
        File.Delete(update.Path);
        Assert.Null(update.OpenVerified());
    }

    [Fact]
    public void TheSetupIsLaunchedSilentlyAndAskedToReopenTheApp() =>
        Assert.Equal(["/SILENT", "/CLOSEAPPLICATIONS", "/RELAUNCH=1", "/NORESTART"], DownloadedUpdate.SetupArguments);

    [Fact]
    public void CleansOldDownloadsButKeepsNewerOnesAndOtherFiles()
    {
        Directory.CreateDirectory(Folder);
        string[] files =
        [
            "Nsound-0.8.0-beta.11-windows-x64-setup.exe", Name, "Nsound-0.8.0-beta.13-windows-x64-setup.exe",
            "Nsound-0.8.0-beta.13-windows-x64-setup.exe.part", "nota.txt",
        ];
        foreach (var file in files) File.WriteAllText(Path.Combine(Folder, file), "");
        Downloader().RemoveInstalled(Version);
        Assert.Equal(["Nsound-0.8.0-beta.13-windows-x64-setup.exe", "nota.txt"], Directory.GetFiles(Folder).Select(Path.GetFileName).Order(StringComparer.Ordinal));
        new UpdateDownloader(Path.Combine(_root, "no-existe")).RemoveInstalled(Version);   // sin carpeta no pasa nada
    }
}
