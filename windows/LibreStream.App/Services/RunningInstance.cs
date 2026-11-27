using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace LibreStream.App;

/// <summary>
/// Con «Seguir en segundo plano» activado, volver a abrir Nsound debe enseñar la ventana escondida y no arrancar un
/// segundo reproductor. La copia en marcha escucha un aviso con nombre; la que llega lo lanza y se cierra.
/// Cada carpeta tiene el suyo: una copia de pruebas no estorba a la instalada.
/// </summary>
internal static class RunningInstance
{
    private static readonly string Name = @"Local\Nsound.Mostrar." +
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(AppContext.BaseDirectory.ToUpperInvariant())))[..24];
    private static EventWaitHandle? _signal;
    private static RegisteredWaitHandle? _wait;

    /// <summary>true si ya había una copia esperando: se le ha pedido que se muestre y esta debe cerrarse.</summary>
    public static bool AskToShow()
    {
        if (!EventWaitHandle.TryOpenExisting(Name, out var signal)) return false;
        using (signal)
        {
            AllowSetForegroundWindow(-1);   // quien acaba de abrirse tiene permiso para ponerse delante: se lo cede
            signal.Set();
        }
        return true;
    }

    /// <summary>Empieza a escuchar; <paramref name="show"/> se llama desde otro hilo.</summary>
    public static void Listen(Action show)
    {
        if (_signal is not null) return;
        _signal = new EventWaitHandle(false, EventResetMode.AutoReset, Name);
        _wait = ThreadPool.RegisterWaitForSingleObject(_signal, (_, _) => show(), null, Timeout.Infinite, executeOnlyOnce: false);
    }

    public static void StopListening()
    {
        _wait?.Unregister(null);
        _signal?.Dispose();
        _wait = null;
        _signal = null;
    }

    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int processId);
}
