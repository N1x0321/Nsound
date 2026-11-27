using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace LibreStream.Core;

/// <summary>La actualización no se puede instalar; el mensaje se enseña tal cual al usuario.</summary>
public sealed class UpdateException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Instalador descargado cuya huella coincidía con la publicada.</summary>
public sealed record DownloadedUpdate(string Path, string Sha256)
{
    /// <summary>Cómo se lanza: en silencio, cerrando la app si siguiera abierta, volviendo a abrirla y sin reiniciar el equipo.</summary>
    public static IReadOnlyList<string> SetupArguments { get; } = ["/SILENT", "/CLOSEAPPLICATIONS", "/RELAUNCH=1", "/NORESTART"];

    /// <summary>
    /// Abre el instalador impidiendo que se cambie o se borre y vuelve a comprobar su huella. Hay que lanzarlo antes de
    /// soltar el fichero devuelto. null si ya no está o no coincide.
    /// </summary>
    public FileStream? OpenVerified()
    {
        FileStream? file = null;
        try
        {
            file = new FileStream(Path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (Convert.ToHexString(SHA256.HashData(file)).Equals(Sha256, StringComparison.OrdinalIgnoreCase)) return file;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* ya no se puede usar */ }
        file?.Dispose();
        return null;
    }
}

/// <summary>
/// Descarga el instalador de una versión publicada y comprueba su SHA-256 con el fichero «.sha256» de la misma Release.
/// Solo pide direcciones de las Releases de Nsound (y su almacén de GitHub al redirigir). No envía datos del usuario.
/// La huella protege de descargas rotas o cambiadas por el camino; no sustituye a una firma, que las betas no llevan.
/// </summary>
public sealed class UpdateDownloader : IDisposable
{
    private const long MaxSetupBytes = 500L * 1024 * 1024;
    private const int MaxChecksumBytes = 1024;
    private const int MaxRedirects = 5;

    private readonly string _folder;
    private readonly HttpClient _http;
    private readonly TimeSpan _stall;

    /// <param name="folder">Donde se guarda el instalador (%LOCALAPPDATA%\LibreStream\updates).</param>
    /// <param name="handler">Solo para pruebas; no debe seguir redirecciones por su cuenta.</param>
    /// <param name="stallTimeout">Tiempo máximo sin recibir nada.</param>
    public UpdateDownloader(string folder, HttpMessageHandler? handler = null, TimeSpan? stallTimeout = null)
    {
        _folder = folder;
        // Las redirecciones se siguen a mano para revisar cada destino antes de pedirlo
        _http = new HttpClient(handler ?? new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false })
        {
            Timeout = Timeout.InfiniteTimeSpan,   // una descarga lenta vale; una parada, no (ver _stall)
        };
        _stall = stallTimeout ?? TimeSpan.FromSeconds(60);
    }

    public void Dispose() => _http.Dispose();

    /// <summary>Huella escrita por build-windows.yml («&lt;hex&gt;  &lt;fichero&gt;»); null si no es la de ese fichero.</summary>
    public static string? ParseChecksum(string text, string fileName)
    {
        var parts = text.TrimStart((char)0xFEFF).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length is not (1 or 2) || parts[0].Length != 64 || !parts[0].All(char.IsAsciiHexDigit)) return null;
        if (parts.Length == 2 && parts[1].TrimStart('*') != fileName) return null;
        return parts[0].ToLowerInvariant();
    }

    /// <summary>
    /// Deja en la carpeta el instalador de <paramref name="version"/> ya comprobado. Si falta la huella o no coincide,
    /// lanza <see cref="UpdateException"/> y no queda ningún fichero que ejecutar.
    /// </summary>
    /// <param name="progress">De 0 a 1.</param>
    public async Task<DownloadedUpdate> DownloadAsync(string tag, string version, string arch,
        IProgress<double>? progress = null, CancellationToken cancel = default)
    {
        // La etiqueta y la versión acaban en una ruta del disco: solo se admiten si son una versión y coinciden
        if (ReleaseVersion.Parse(tag)?.Text != version || tag.TrimStart('v') != version || arch is not ("x64" or "arm64" or "x86"))
            throw new UpdateException("No se reconoce la versión publicada.");
        var name = UpdateAssets.SetupName(version, arch);
        var final = Path.Combine(_folder, name);
        var partial = final + ".part";
        using var stall = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        try
        {
            var expected = await ChecksumAsync(UpdateAssets.DownloadUrl(tag, name + ".sha256"), name, stall).ConfigureAwait(false);
            Directory.CreateDirectory(_folder);
            Clean(keep: name);
            var ready = new DownloadedUpdate(final, expected);
            using (var existing = ready.OpenVerified())    // ya se descargó antes y se dejó para más tarde
                if (existing is not null) { progress?.Report(1); return ready; }

            var actual = await SaveAsync(UpdateAssets.DownloadUrl(tag, name), partial, progress, stall).ConfigureAwait(false);
            if (actual != expected)
            {
                Delete(final);
                throw new UpdateException("El archivo descargado no coincide con la huella publicada. No se ha instalado nada.");
            }
            File.Move(partial, final, overwrite: true);
            return ready;
        }
        catch (OperationCanceledException e) when (!cancel.IsCancellationRequested)
        {
            throw new UpdateException("La descarga se ha quedado parada. Comprueba la conexión y vuelve a intentarlo.", e);
        }
        catch (Exception e) when (e is HttpRequestException or IOException)
        {
            throw new UpdateException("No se pudo descargar la actualización. Comprueba la conexión y el espacio libre.", e);
        }
        catch (UnauthorizedAccessException e)
        {
            throw new UpdateException("No se pudo guardar la actualización en el equipo.", e);
        }
        finally { Delete(partial); }
    }

    /// <summary>Borra los instaladores que ya no sirven: los de la versión instalada o anteriores, y los restos a medias.</summary>
    public void RemoveInstalled(string installedVersion)
    {
        if (ReleaseVersion.Parse(installedVersion) is not { } installed) return;
        foreach (var file in Files())
        {
            var name = Path.GetFileName(file);
            var end = name.IndexOf("-windows-", StringComparison.Ordinal);
            var version = end > "Nsound-".Length ? ReleaseVersion.Parse(name["Nsound-".Length..end]) : null;
            if (name.EndsWith(".part", StringComparison.Ordinal) || (version is not null && version.CompareTo(installed) <= 0)) Delete(file);
        }
    }

    private void Clean(string keep)
    {
        foreach (var file in Files())
            if (Path.GetFileName(file) != keep) Delete(file);
    }

    private string[] Files()
    {
        try
        {
            return Directory.Exists(_folder)
                ? Directory.GetFiles(_folder, "Nsound-*").Where(f => f.EndsWith("-setup.exe", StringComparison.Ordinal) || f.EndsWith(".part", StringComparison.Ordinal)).ToArray()
                : [];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return []; }
    }

    private static void Delete(string file)
    {
        try { File.Delete(file); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* en uso o sin permiso: se intentará otra vez */ }
    }

    private async Task<string> ChecksumAsync(Uri url, string name, CancellationTokenSource stall)
    {
        using var response = await GetAsync(url, stall).ConfigureAwait(false);
        await using var body = await response.Content.ReadAsStreamAsync(stall.Token).ConfigureAwait(false);
        var buffer = new byte[MaxChecksumBytes + 1];
        var length = 0;
        int read;
        while (length < buffer.Length && (read = await body.ReadAsync(buffer.AsMemory(length), stall.Token).ConfigureAwait(false)) > 0) length += read;
        return (length <= MaxChecksumBytes ? ParseChecksum(Encoding.UTF8.GetString(buffer, 0, length), name) : null)
            ?? throw new UpdateException("La huella publicada de esta versión no es válida. No se ha instalado nada.");
    }

    private async Task<string> SaveAsync(Uri url, string file, IProgress<double>? progress, CancellationTokenSource stall)
    {
        using var response = await GetAsync(url, stall).ConfigureAwait(false);
        var total = response.Content.Headers.ContentLength;
        if (total > MaxSetupBytes) throw new UpdateException("El archivo publicado es demasiado grande. No se ha descargado.");
        await using var body = await response.Content.ReadAsStreamAsync(stall.Token).ConfigureAwait(false);
        await using var output = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.None);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[81920];
        long done = 0;
        var shown = -1;
        while (true)
        {
            stall.CancelAfter(_stall);
            var read = await body.ReadAsync(buffer, stall.Token).ConfigureAwait(false);
            if (read == 0) break;
            done += read;
            if (done > MaxSetupBytes) throw new UpdateException("El archivo publicado es demasiado grande. No se ha descargado.");
            hash.AppendData(buffer, 0, read);
            await output.WriteAsync(buffer.AsMemory(0, read), stall.Token).ConfigureAwait(false);
            if (total is > 0 && (int)(done * 100 / total.Value) is var percent && percent != shown)
            {
                shown = percent;
                progress?.Report(Math.Min(percent, 100) / 100.0);
            }
        }
        if (total is { } expected && done != expected) throw new IOException("La descarga llegó incompleta.");
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private async Task<HttpResponseMessage> GetAsync(Uri url, CancellationTokenSource stall)
    {
        if (!UpdateAssets.IsReleaseUrl(url)) throw Rejected();
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            stall.CancelAfter(_stall);
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Nsound", null));   // sin datos de nadie
            var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stall.Token).ConfigureAwait(false);
            var keep = false;
            try
            {
                // Por si algo hubiera seguido una redirección sin pasar por aquí
                if (response.RequestMessage?.RequestUri is { } answered && !UpdateAssets.IsAllowedRedirect(answered)) throw Rejected();
                if (response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther
                    or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
                {
                    if (response.Headers.Location is not { } location) throw Rejected();
                    url = new Uri(url, location);
                    if (!UpdateAssets.IsAllowedRedirect(url)) throw Rejected();
                    continue;
                }
                if (response.StatusCode == HttpStatusCode.NotFound)
                    throw new UpdateException("A esta versión le falta el instalador o su huella. No se ha instalado nada.");
                response.EnsureSuccessStatusCode();
                keep = true;
                return response;
            }
            finally { if (!keep) response.Dispose(); }
        }
        throw Rejected();

        static UpdateException Rejected() => new("La descarga apuntaba fuera de las descargas de Nsound. No se ha instalado nada.");
    }
}
