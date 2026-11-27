using System.Text.Json;

namespace LibreStream.Core;

/// <summary>Búsquedas recientes, solo en este PC (searches.json): salen al pinchar en «Buscar». No salen del equipo.</summary>
public sealed class SearchHistory
{
    public const int Max = 10;
    private const int MaxLength = 100;

    private readonly string _file;
    private readonly List<string> _items;

    public SearchHistory(string dir)
    {
        Directory.CreateDirectory(dir);
        _file = Path.Combine(dir, "searches.json");
        _items = Load(_file);
    }

    /// <summary>De la más reciente a la más antigua.</summary>
    public IReadOnlyList<string> Items => _items;

    /// <summary>Pone la búsqueda la primera. Repetirla (aunque cambien mayúsculas o tildes) no la duplica; una sola letra no cuenta.</summary>
    public void Add(string? query)
    {
        if (Clean(query) is not { } text) return;
        var folded = MetadataMatcher.Fold(text);
        _items.RemoveAll(item => MetadataMatcher.Fold(item) == folded);
        _items.Insert(0, text);
        if (_items.Count > Max) _items.RemoveRange(Max, _items.Count - Max);
        Save();
    }

    /// <summary>Las recientes que contienen lo que se está escribiendo; sin texto, todas.</summary>
    public IReadOnlyList<string> Matching(string? typed)
    {
        var folded = MetadataMatcher.Fold(typed?.Trim() ?? "");
        return folded.Length == 0
            ? [.. _items]
            : _items.Where(item => MetadataMatcher.Fold(item) is var other && other != folded && other.Contains(folded, StringComparison.Ordinal)).ToList();
    }

    public void Clear()
    {
        _items.Clear();
        Save();
    }

    private static string? Clean(string? query)
    {
        var text = query?.Trim() ?? "";
        if (text.Length > MaxLength) text = text[..MaxLength].TrimEnd();
        return text.Length < 2 || MetadataMatcher.Fold(text).Length == 0 ? null : text;
    }

    private static List<string> Load(string file)
    {
        try
        {
            var saved = File.Exists(file) ? JsonSerializer.Deserialize<List<string?>>(File.ReadAllText(file)) : null;
            return saved?.Select(Clean).OfType<string>().Take(Max).ToList() ?? [];
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException) { return []; }
    }

    private void Save()
    {
        try { File.WriteAllText(_file, JsonSerializer.Serialize(_items)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* se recordarán hasta cerrar */ }
    }
}
