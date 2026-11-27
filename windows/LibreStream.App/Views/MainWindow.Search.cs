using LibreStream.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace LibreStream.App;

/// <summary>
/// Búsquedas recientes en el cuadro «Buscar». Como la búsqueda va saliendo mientras se escribe, solo se guarda lo que de
/// verdad se ha usado: al pulsar Intro o al reproducir un resultado. Nunca lo que pone la app sola (un artista o un disco).
/// </summary>
public sealed partial class MainWindow
{
    private const string ClearSearches = "✕  Borrar búsquedas recientes";

    private readonly SearchHistory _searches = new(DataDir);
    private string _typedQuery = "";    // lo último escrito (o elegido) por el usuario

    /// <summary>La búsqueda en pantalla ha servido: se guarda si la escribió el usuario.</summary>
    private void RememberSearch()
    {
        if (_typedQuery.Length > 0 && Search.Text == _typedQuery) _searches.Add(_typedQuery);
    }

    private void ShowRecentSearches(string typed)
    {
        List<string> items = [.. _searches.Matching(typed)];
        if (items.Count > 0 && typed.Trim().Length == 0) items.Add(ClearSearches);
        Search.ItemsSource = items;
        Search.IsSuggestionListOpen = items.Count > 0 && Search.FocusState != FocusState.Unfocused;
    }

    // Solo si se llega al cuadro a propósito: al abrir la app no se despliega nada
    private void Search_GotFocus(object sender, RoutedEventArgs e)
    {
        if (Search.Text.Length == 0 && (e.OriginalSource as Control)?.FocusState is FocusState.Pointer or FocusState.Keyboard)
            Safe("Búsquedas recientes", () => ShowRecentSearches(""));
    }

    private void Search_Tapped(object sender, TappedRoutedEventArgs e)
    {
        if (Search.Text.Length == 0 && !Search.IsSuggestionListOpen) Safe("Búsquedas recientes", () => ShowRecentSearches(""));
    }
}
