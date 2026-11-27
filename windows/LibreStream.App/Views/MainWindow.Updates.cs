using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using LibreStream.Core;
using Microsoft.UI.Xaml;

namespace LibreStream.App;

/// <summary>Aviso «Hay una versión nueva»: Nsound no se instala desde una tienda, así que avisa y abre la descarga.</summary>
public sealed partial class MainWindow
{
    private UpdateChecker? _updates;
    private AvailableUpdate? _update;
    // El temporizador solo sirve para sesiones largas: el comprobador no consulta más de una vez al día
    private readonly DispatcherTimer _updateTimer = new() { Interval = TimeSpan.FromHours(3) };

    /// <summary>Versión instalada: la etiqueta que build-windows.yml pasa con -p:Version («0.0.0-dev» en compilaciones locales).</summary>
    private static string InstalledVersion =>
        typeof(MainWindow).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "";

    private void StartUpdateChecks()
    {
        VersionText.Text = "Versión " + InstalledVersion;
        var suffix = RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "-windows-arm64.zip" : "-windows-x64.zip";
        try { _updates = new UpdateChecker(DataDir, InstalledVersion, suffix, FetchReleasesAsync); }
        catch (Exception ex) { App.Log("Versiones nuevas", ex); return; }
        _updateTimer.Tick += (_, _) => _ = CheckUpdatesAsync();
        _updateTimer.Start();
        Closed += (_, _) => _updateTimer.Stop();
        _ = CheckUpdatesAsync();
    }

    private async Task<string> FetchReleasesAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, UpdateChecker.ReleasesApi);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("Nsound", null));   // GitHub exige un nombre; no lleva datos de nadie
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        using var response = await _http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync();
    }

    private async Task CheckUpdatesAsync()
    {
        if (_updates is null) return;
        try { ShowUpdate(await _updates.CheckAsync()); }
        catch (Exception ex) { App.LogOnce("Versiones nuevas", ex); }
    }

    private void ShowUpdate(AvailableUpdate? update)
    {
        _update = update;
        UpdateText.Text = update is null ? "" : $"Hay una versión nueva ({update.Version})";
        UpdateNotice.Visibility = Vis(update is not null);
    }

    private async void UpdateDownload_Click(object sender, RoutedEventArgs e)
    {
        if (_update is null) return;
        try { await Windows.System.Launcher.LaunchUriAsync(new Uri(_update.Url)); }
        catch (Exception ex) { App.Log("Abrir la descarga", ex); ShowStatus("No se pudo abrir el navegador. Descárgala en github.com/N1x0321/Nsound/releases"); }
    }

    private void UpdateDismiss_Click(object sender, RoutedEventArgs e)
    {
        if (_update is not null) _updates?.Dismiss(_update.Version);
        ShowUpdate(null);
    }
}
