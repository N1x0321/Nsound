using System.Text.Json;

namespace LibreStream.Core;

/// <summary>Versión más nueva que la instalada y la página donde se descarga.</summary>
public sealed record AvailableUpdate(string Version, string Url)
{
    /// <summary>Etiqueta de la Release («v0.8.0-beta.12»), la última parte de la dirección.</summary>
    public string Tag => Url[(Url.LastIndexOf('/') + 1)..];
}

/// <summary>
/// Aviso de versiones nuevas: pregunta a las Releases públicas de GitHub como máximo una vez al día, sin cuentas ni telemetría.
/// Misma lógica que app/src/js/00-update.js. El estado se guarda en updates.json.
/// </summary>
public sealed class UpdateChecker
{
    public const string ReleasesApi = "https://api.github.com/repos/N1x0321/Nsound/releases?per_page=20";
    private const string ReleasePage = "https://github.com/N1x0321/Nsound/releases/tag/";
    private static readonly TimeSpan Interval = TimeSpan.FromDays(1);

    private sealed class State
    {
        public DateTimeOffset? LastCheck { get; set; }
        public string? Tag { get; set; }
        public string? Dismissed { get; set; }
    }

    private readonly string _file;
    private readonly ReleaseVersion? _installed;
    private readonly string _assetSuffix;
    private readonly Func<Task<string>> _fetch;
    private readonly Func<DateTimeOffset> _now;
    private readonly State _state;
    private bool _busy;

    /// <param name="assetSuffix">Final del fichero de esta plataforma («-windows-x64.zip»): una Release sin él todavía no se anuncia.</param>
    /// <param name="fetch">Descarga el JSON de <see cref="ReleasesApi"/>.</param>
    public UpdateChecker(string dir, string? installed, string assetSuffix, Func<Task<string>> fetch, Func<DateTimeOffset>? now = null)
    {
        Directory.CreateDirectory(dir);
        _file = Path.Combine(dir, "updates.json");
        _installed = ReleaseVersion.Parse(installed);
        _assetSuffix = assetSuffix;
        _fetch = fetch;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _state = Load(_file);
    }

    /// <summary>Aviso pendiente según lo último que se supo, sin conectarse.</summary>
    public AvailableUpdate? Current
    {
        get
        {
            var latest = ReleaseVersion.Parse(_state.Tag);
            if (_installed is null || _installed.IsDevelopment || latest is null) return null;
            if (latest.CompareTo(_installed) <= 0 || latest.Text == _state.Dismissed) return null;
            return new AvailableUpdate(latest.Text, ReleasePage + _state.Tag);
        }
    }

    /// <summary>Consulta si ha pasado un día desde la última vez. Un fallo de red no avisa de nada nuevo ni lanza errores.</summary>
    public async Task<AvailableUpdate?> CheckAsync()
    {
        if (_installed is null || _installed.IsDevelopment || _busy) return Current;
        var now = _now();
        if (_state.LastCheck is { } last && now >= last && now - last < Interval) return Current;
        _busy = true;
        try
        {
            _state.LastCheck = now;    // el intento cuenta aunque falle: nunca más de una consulta al día
            Save();
            _state.Tag = LatestTag(await _fetch(), _assetSuffix);
            Save();
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or JsonException or IOException or UnauthorizedAccessException)
        {
            // sin conexión, límite de GitHub o respuesta rara: se volverá a mirar otro día
        }
        finally { _busy = false; }
        return Current;
    }

    /// <summary>No volver a avisar de esta versión (de las siguientes, sí).</summary>
    public void Dismiss(string version)
    {
        _state.Dismissed = version;
        try { Save(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* se recordará solo hasta cerrar */ }
    }

    /// <summary>Etiqueta de la Release más alta (sin contar borradores) que ya tiene el fichero de esta plataforma, o null.</summary>
    public static string? LatestTag(string releasesJson, string assetSuffix)
    {
        using var doc = JsonDocument.Parse(releasesJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) throw new JsonException("Se esperaba una lista de versiones.");
        ReleaseVersion? best = null;
        string? bestTag = null;
        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (release.ValueKind != JsonValueKind.Object) continue;
            if (release.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True) continue;
            var tag = Text(release, "tag_name");
            var version = ReleaseVersion.Parse(tag);
            if (version is null || version.IsDevelopment || !HasAsset(release, assetSuffix)) continue;
            if (best is null || version.CompareTo(best) > 0) (best, bestTag) = (version, tag);
        }
        return bestTag;
    }

    private static bool HasAsset(JsonElement release, string suffix) =>
        release.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array
        && assets.EnumerateArray().Any(a => a.ValueKind == JsonValueKind.Object
            && Text(a, "name")?.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) == true
            && Text(a, "state") is null or "uploaded");

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static State Load(string file)
    {
        try { return File.Exists(file) ? JsonSerializer.Deserialize<State>(File.ReadAllText(file)) ?? new State() : new State(); }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException) { return new State(); }
    }

    private void Save() => File.WriteAllText(_file, JsonSerializer.Serialize(_state));
}
