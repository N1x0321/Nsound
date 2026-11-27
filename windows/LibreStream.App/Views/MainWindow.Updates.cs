using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using LibreStream.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LibreStream.App;

/// <summary>
/// Aviso «Hay una versión nueva»: Nsound no se instala desde una tienda, así que avisa. Las copias puestas con el
/// instalador ofrecen «Actualizar ahora» (descarga, comprueba, pregunta e instala); las del zip portable abren la descarga.
/// </summary>
public sealed partial class MainWindow
{
    private UpdateChecker? _updates;
    private AvailableUpdate? _update;
    private UpdateDownloader? _downloader;              // null en el zip portable
    private string _updateArch = "x64";
    private CancellationTokenSource? _updateCancel;     // distinto de null mientras se descarga o se instala
    // El temporizador solo sirve para sesiones largas: el comprobador no consulta más de una vez al día
    private readonly DispatcherTimer _updateTimer = new() { Interval = TimeSpan.FromHours(3) };

    /// <summary>Versión instalada: la etiqueta que build-windows.yml pasa con -p:Version («0.0.0-dev» en compilaciones locales).</summary>
    private static string InstalledVersion =>
        typeof(MainWindow).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "";

    private void StartUpdateChecks()
    {
        VersionText.Text = "Versión " + InstalledVersion;
        var arch = UpdateAssets.ArchName(RuntimeInformation.ProcessArchitecture);
        _updateArch = arch ?? "x64";
        try
        {
            if (arch is not null && InstallKind.IsInstalledWithSetup(AppContext.BaseDirectory))
            {
                _downloader = new UpdateDownloader(Path.Combine(DataDir, "updates"));
                _downloader.RemoveInstalled(InstalledVersion);
            }
            // Cada copia solo se entera de las versiones que ya tienen SU fichero: el instalador o el zip
            var suffix = _downloader is null ? UpdateAssets.ZipSuffix(_updateArch) : UpdateAssets.SetupSuffix(_updateArch);
            _updates = new UpdateChecker(DataDir, InstalledVersion, suffix, FetchReleasesAsync);
        }
        catch (Exception ex) { App.Log("Versiones nuevas", ex); return; }
        _updateTimer.Tick += (_, _) => _ = CheckUpdatesAsync();
        _updateTimer.Start();
        Closed += (_, _) => { _updateTimer.Stop(); _updateCancel?.Cancel(); };
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
        try
        {
            var update = await _updates.CheckAsync();
            // No se pisa una descarga en marcha ni lo que se esté contando de la misma versión
            if (_updateCancel is null && (update != _update || UpdateNotice.Visibility == Visibility.Collapsed)) ShowUpdate(update);
        }
        catch (Exception ex) { App.LogOnce("Versiones nuevas", ex); }
    }

    private void ShowUpdate(AvailableUpdate? update)
    {
        _update = update;
        ShowUpdateState(update is null ? "" : $"Hay una versión nueva ({update.Version})");
        UpdateNotice.Visibility = Vis(update is not null);
    }

    /// <summary>Texto del aviso y qué se puede pulsar: la acción (salvo mientras se descarga) y, si algo falló, la descarga a mano.</summary>
    private void ShowUpdateState(string text, bool busy = false, bool failed = false)
    {
        UpdateText.Text = text;
        UpdateAction.Content = _downloader is null ? "Descargar" : "Actualizar ahora";
        UpdateAction.Visibility = Vis(!busy);
        UpdateManual.Visibility = Vis(failed);
        UpdateBar.Visibility = Vis(busy);
    }

    private async void UpdateAction_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (_downloader is null) await OpenReleasePageAsync();
            else await UpdateNowAsync(_downloader);
        }
        catch (Exception ex) { App.Log("Actualizar", ex); }
    }

    private async void UpdateManual_Click(object sender, RoutedEventArgs e)
    {
        try { await OpenReleasePageAsync(); }
        catch (Exception ex) { App.Log("Abrir la descarga", ex); }
    }

    private async Task OpenReleasePageAsync()
    {
        if (_update is null) return;
        try { await Windows.System.Launcher.LaunchUriAsync(new Uri(_update.Url)); }
        catch (Exception ex) { App.Log("Abrir la descarga", ex); ShowStatus("No se pudo abrir el navegador. Descárgala en github.com/N1x0321/Nsound/releases"); }
    }

    private async Task UpdateNowAsync(UpdateDownloader downloader)
    {
        if (_updateCancel is not null || _update is not { } update) return;
        using var cancel = new CancellationTokenSource();
        _updateCancel = cancel;
        try
        {
            var downloading = $"Descargando la versión {update.Version}…";
            ShowUpdateState(downloading, busy: true);
            UpdateBar.Value = 0;
            var progress = new Progress<double>(done =>
            {
                if (_updateCancel != cancel || UpdateBar.Visibility != Visibility.Visible) return;
                UpdateBar.Value = done;
                UpdateText.Text = $"{downloading} {done * 100:0} %";
            });
            var file = await Task.Run(() => downloader.DownloadAsync(update.Tag, update.Version, _updateArch, progress, cancel.Token));
            cancel.Token.ThrowIfCancellationRequested();

            ShowUpdateState($"La versión {update.Version} está lista para instalar.");
            if (!await ConfirmInstallAsync(update.Version) || cancel.IsCancellationRequested) return;

            ShowUpdateState("Abriendo el instalador…", busy: true);
            UpdateBar.Value = 1;
            // El fichero queda bloqueado desde que se vuelve a comprobar hasta que el instalador ha arrancado
            using var verified = await Task.Run(file.OpenVerified);
            if (verified is null)
            {
                ShowUpdateState("El archivo descargado ha cambiado y no se ha ejecutado. Vuelve a intentarlo.", failed: true);
                return;
            }
            Safe("Guardar ajustes", _settings.Save);
            var start = new ProcessStartInfo(file.Path) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(file.Path)! };
            foreach (var argument in DownloadedUpdate.SetupArguments) start.ArgumentList.Add(argument);
            using (Process.Start(start)) { }
            Close();                       // el instalador sustituye los ficheros y vuelve a abrir Nsound
            Application.Current.Exit();
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested) { /* aviso descartado o app cerrándose */ }
        catch (UpdateException ex)
        {
            App.Log("Actualizar", ex);
            if (!cancel.IsCancellationRequested) ShowUpdateState(ex.Message, failed: true);
        }
        catch (Exception ex)
        {
            App.Log("Actualizar", ex);
            if (!cancel.IsCancellationRequested) ShowUpdateState("No se pudo instalar la actualización. Inténtalo de nuevo o descárgala a mano.", failed: true);
        }
        finally { if (_updateCancel == cancel) _updateCancel = null; }
    }

    private async Task<bool> ConfirmInstallAsync(string version)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = Root.XamlRoot, Title = $"¿Instalar la versión {version}?",
            Content = new TextBlock { Text = "Nsound se cerrará, se actualizará y volverá a abrirse. Tu biblioteca, tus listas y tus ajustes se conservan.", TextWrapping = TextWrapping.Wrap },
            PrimaryButtonText = "Instalar ahora", CloseButtonText = "Más tarde", DefaultButton = ContentDialogButton.Primary,
            RequestedTheme = ElementTheme.Dark,
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    private void UpdateDismiss_Click(object sender, RoutedEventArgs e)
    {
        _updateCancel?.Cancel();
        _updateCancel = null;
        if (_update is not null) _updates?.Dismiss(_update.Version);
        ShowUpdate(null);
    }
}
