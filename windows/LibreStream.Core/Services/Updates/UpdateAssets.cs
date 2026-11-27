using System.Runtime.InteropServices;

namespace LibreStream.Core;

/// <summary>Ficheros de Windows de cada Release y direcciones desde las que se permite descargarlos.</summary>
public static class UpdateAssets
{
    private const string DownloadPath = "/N1x0321/Nsound/releases/download/";

    // GitHub no sirve los ficheros desde github.com: redirige a su almacén, y en la ruta va el número del repositorio
    // (no cambia aunque se renombre). Así solo vale el almacén de ESTE repositorio. Si GitHub cambiara de almacén,
    // la actualización automática fallaría sin instalar nada y quedaría la descarga a mano.
    private const string RepositoryId = "1453134198";
    private static readonly (string Host, string Path)[] Storage =
    [
        ("release-assets.githubusercontent.com", $"/github-production-release-asset/{RepositoryId}/"),
        ("objects.githubusercontent.com", $"/github-production-release-asset-2e65be/{RepositoryId}/"),
    ];

    /// <summary>«x64», «arm64» o «x86» según el proceso; null si no se publica para esa arquitectura.</summary>
    public static string? ArchName(Architecture architecture) => architecture switch
    {
        Architecture.X64 => "x64",
        Architecture.Arm64 => "arm64",
        Architecture.X86 => "x86",
        _ => null,
    };

    public static string ZipSuffix(string arch) => $"-windows-{arch}.zip";

    public static string SetupSuffix(string arch) => $"-windows-{arch}-setup.exe";

    public static string SetupName(string version, string arch) => $"Nsound-{version}{SetupSuffix(arch)}";

    public static Uri DownloadUrl(string tag, string fileName) => new($"https://github.com{DownloadPath}{tag}/{fileName}");

    /// <summary>Un fichero de una Release de Nsound: https://github.com/N1x0321/Nsound/releases/download/etiqueta/fichero.</summary>
    public static bool IsReleaseUrl(Uri url)
    {
        if (!IsPlainHttps(url) || url.IdnHost != "github.com") return false;
        var path = url.AbsolutePath;
        if (!path.StartsWith(DownloadPath, StringComparison.Ordinal) || path.Contains('%')) return false;
        var rest = path[DownloadPath.Length..].Split('/');
        return rest.Length == 2 && rest.All(part => part.Length > 0);
    }

    /// <summary>Destino aceptable de una redirección: otra dirección de las Releases de Nsound o su almacén en GitHub.</summary>
    public static bool IsAllowedRedirect(Uri url) =>
        IsReleaseUrl(url)
        || (IsPlainHttps(url) && Storage.Any(s => url.IdnHost == s.Host && url.AbsolutePath.StartsWith(s.Path, StringComparison.Ordinal)));

    private static bool IsPlainHttps(Uri url) =>
        url.IsAbsoluteUri && url.Scheme == Uri.UriSchemeHttps && url.IsDefaultPort && url.UserInfo.Length == 0;
}

/// <summary>Cómo se instaló esta copia de Nsound.</summary>
public static class InstallKind
{
    /// <summary>
    /// El instalador (Inno Setup) deja su desinstalador junto a la app; el zip portable no lo lleva.
    /// Solo las copias instaladas se actualizan solas: a las del zip se les enseña la descarga.
    /// </summary>
    public static bool IsInstalledWithSetup(string appDirectory) =>
        File.Exists(Path.Combine(appDirectory, "unins000.exe")) && File.Exists(Path.Combine(appDirectory, "unins000.dat"));
}
