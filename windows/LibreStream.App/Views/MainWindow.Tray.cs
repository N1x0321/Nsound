using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace LibreStream.App;

/// <summary>
/// «Seguir en segundo plano al cerrar»: la X esconde la ventana, la música sigue y Nsound queda como icono junto al reloj.
/// Para cerrarlo del todo, clic derecho en el icono → «Salir de Nsound». Viene desactivado.
/// </summary>
public sealed partial class MainWindow
{
    private TrayIcon? _tray;
    private bool _exiting;      // se está cerrando de verdad: la ventana no debe esconderse

    private void StartTray()
    {
        TrayToggle.IsOn = _settings.Current.KeepInTray;
        AppWindow.Closing += (_, e) =>
        {
            // Sin icono en la barra no se esconde nunca: no habría forma de volver ni de salir
            if (_exiting || !_settings.Current.KeepInTray || _tray?.Shown != true) return;
            e.Cancel = true;
            Safe("Guardar ajustes", _settings.Save);
            Safe("Esconder la ventana", () => AppWindow.Hide());
        };
        Closed += (_, _) => Safe("Cierre del icono", () => { RunningInstance.StopListening(); _tray?.Dispose(); _tray = null; });
        Safe("Icono junto al reloj", ApplyTraySetting);
    }

    private void ApplyTraySetting()
    {
        if (!_settings.Current.KeepInTray)
        {
            RunningInstance.StopListening();
            _tray?.Hide();
            return;
        }
        _tray ??= new TrayIcon(WinRT.Interop.WindowNative.GetWindowHandle(this),
            Path.Combine(AppContext.BaseDirectory, "Assets", "icon.ico"),
            () => Safe("Icono: abrir", ShowMainWindow),
            () => Safe("Icono: reproducir", () => Play_Click(this, null!)),
            () => Safe("Icono: anterior", Previous),
            () => Safe("Icono: siguiente", Next),
            () => Safe("Icono: salir", ExitApp),
            () => _exiting = true);
        _tray.Show();
        _tray.Update(IsPlaying, _now is not null, _now?.Title);
        if (_tray.Shown) RunningInstance.Listen(() => DispatcherQueue.TryEnqueue(() => Safe("Volver a mostrar", ShowMainWindow)));
    }

    private void ShowMainWindow()
    {
        _exiting = false;   // si Windows canceló un apagado, la X vuelve a esconder
        AppWindow.Show();
        (AppWindow.Presenter as OverlappedPresenter)?.Restore();
        Activate();
    }

    /// <summary>Cierra Nsound de verdad, aunque esté en segundo plano.</summary>
    private void ExitApp()
    {
        _exiting = true;
        Close();
        Application.Current.Exit();
    }

    private void Tray_Toggled(object sender, RoutedEventArgs e)
    {
        if (_settings.Current.KeepInTray == TrayToggle.IsOn) return;
        _settings.Current.KeepInTray = TrayToggle.IsOn;
        ScheduleSave();
        Safe("Icono junto al reloj", ApplyTraySetting);
        var failed = TrayToggle.IsOn && _tray?.Shown != true;
        ShowToast("", failed ? "No se pudo poner el icono junto al reloj" : TrayToggle.IsOn ? "Al cerrar, Nsound seguirá junto al reloj" : "Al cerrar, Nsound se apagará");
    }
}
