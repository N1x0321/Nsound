namespace LibreStream.Core;

/// <summary>
/// Operaciones de la cola de reproducción (la canción actual es <c>queue[index]</c>). Mismas reglas que la interfaz web
/// (<c>app/src/js/00-queue.js</c>): sin duplicados, y la canción actual nunca se quita ni se mueve.
/// </summary>
public static class QueueOps
{
    /// <summary>Añade justo después de la actual (<paramref name="next"/>) o al final. Si ya estaba más adelante, se mueve.</summary>
    public static void Add<T>(List<T> queue, ref int index, T item, bool next, Func<T, T, bool> same)
    {
        if (index < 0 || index >= queue.Count) { queue.Clear(); queue.Add(item); index = 0; return; }
        var current = queue[index];
        if (same(current, item)) return;
        for (var i = queue.Count - 1; i >= 0; i--)
            if (i != index && same(queue[i], item)) { queue.RemoveAt(i); if (i < index) index--; }
        if (next) queue.Insert(index + 1, item); else queue.Add(item);
    }

    /// <summary>Quita la canción en <paramref name="pos"/> (nunca la actual).</summary>
    public static bool Remove<T>(List<T> queue, ref int index, int pos)
    {
        if (index < 0 || pos < 0 || pos >= queue.Count || pos == index) return false;
        queue.RemoveAt(pos);
        if (pos < index) index--;
        return true;
    }

    /// <summary>Sube (-1) o baja (+1) una canción de las que vienen después de la actual.</summary>
    public static bool Move<T>(List<T> queue, int index, int pos, int dir)
    {
        var to = pos + dir;
        if (index < 0 || pos <= index || to <= index || to >= queue.Count || pos >= queue.Count) return false;
        (queue[pos], queue[to]) = (queue[to], queue[pos]);
        return true;
    }

    /// <summary>Vacía lo que viene después de la actual.</summary>
    public static void ClearUpcoming<T>(List<T> queue, int index)
    {
        if (index >= 0 && index < queue.Count - 1) queue.RemoveRange(index + 1, queue.Count - index - 1);
    }

    public const string RepeatOff = "off", RepeatAll = "all", RepeatOne = "one";

    /// <summary>Repetir, como en Spotify: sin repetir → la lista → la canción → sin repetir. Un valor desconocido cuenta como apagado.</summary>
    public static string NextRepeat(string? mode) => mode == RepeatAll ? RepeatOne : mode == RepeatOne ? RepeatOff : RepeatAll;

    /// <summary>Qué canción suena después: <c>Index</c> -1 = se acabó la lista; <c>Seen</c> = claves ya sonadas en este aleatorio.</summary>
    public readonly record struct Next(int Index, List<string> Seen);

    /// <summary>
    /// Mismas reglas que <c>LS.pickNextIndex</c>. Aleatorio: no repite hasta haber sonado todas (y entonces, solo si se repite la lista).
    /// <paramref name="rand"/> devuelve un número en [0, 1).
    /// </summary>
    public static Next PickNextIndex<T>(IReadOnlyList<T> queue, int index, string? repeat, bool shuffle, IEnumerable<string>? seen, Func<T, string> key, Func<double>? rand = null)
    {
        var n = queue.Count;
        if (n == 0) return new(-1, []);
        rand ??= Random.Shared.NextDouble;
        var heard = new HashSet<string>(seen ?? []);
        var valid = index >= 0 && index < n;
        if (valid) heard.Add(key(queue[index]));
        if (shuffle && n > 1)
        {
            var cands = Enumerable.Range(0, n).Where(i => i != index && !heard.Contains(key(queue[i]))).ToList();
            if (cands.Count == 0)
            {
                if (repeat != RepeatAll) return new(-1, [.. heard]);
                heard = valid ? [key(queue[index])] : [];
                cands = Enumerable.Range(0, n).Where(i => i != index).ToList();
            }
            return new(cands[Math.Min(cands.Count - 1, (int)Math.Floor(rand() * cands.Count))], [.. heard]);
        }
        if (index + 1 < n) return new(index + 1, [.. heard]);
        return repeat == RepeatAll ? new(0, []) : new(-1, [.. heard]);
    }
}
