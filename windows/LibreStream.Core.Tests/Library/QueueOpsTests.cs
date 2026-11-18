using LibreStream.Core;
using Xunit;

namespace LibreStream.Core.Tests;

public class QueueOpsTests
{
    private static bool Same(string a, string b) => a == b;

    [Fact]
    public void AddNextAndEndWithoutDuplicates()
    {
        var q = new List<string> { "1", "2", "3" }; var i = 0;
        QueueOps.Add(q, ref i, "9", true, Same);
        Assert.Equal(["1", "9", "2", "3"], q);
        QueueOps.Add(q, ref i, "9", false, Same);                 // ya estaba: se mueve al final
        Assert.Equal(["1", "2", "3", "9"], q);
        q = ["1", "2", "3"]; i = 1;
        QueueOps.Add(q, ref i, "1", true, Same);                  // una anterior: pasa a continuación y el índice se ajusta
        Assert.Equal(["2", "1", "3"], q); Assert.Equal(0, i);
        QueueOps.Add(q, ref i, "2", false, Same);                 // la actual no se duplica
        Assert.Equal(["2", "1", "3"], q);
    }

    [Fact]
    public void AddToEmptyQueueStartsIt()
    {
        var q = new List<string>(); var i = -1;
        QueueOps.Add(q, ref i, "a", true, Same);
        Assert.Equal(["a"], q); Assert.Equal(0, i);
    }

    [Fact]
    public void RemoveMoveAndClear()
    {
        var q = new List<string> { "1", "2", "3", "4" }; var i = 1;
        Assert.False(QueueOps.Remove(q, ref i, 1));               // la actual no se quita
        Assert.True(QueueOps.Remove(q, ref i, 0));                // quitar una anterior reajusta el índice
        Assert.Equal(["2", "3", "4"], q); Assert.Equal(0, i);
        Assert.True(QueueOps.Move(q, i, 2, -1));
        Assert.Equal(["2", "4", "3"], q);
        Assert.False(QueueOps.Move(q, i, 1, -1));                 // no pasa por encima de la actual
        Assert.False(QueueOps.Move(q, i, 2, 1));                  // ni se sale por abajo
        QueueOps.ClearUpcoming(q, i);
        Assert.Equal(["2"], q);
    }
}

public class RepeatShuffleTests
{
    private static string[] Mk(int n) => Enumerable.Range(0, n).Select(i => "k" + i).ToArray();
    private static QueueOps.Next Pick(string[] q, int i, string repeat = "off", bool shuffle = false, IEnumerable<string>? seen = null, Func<double>? rand = null)
        => QueueOps.PickNextIndex(q, i, repeat, shuffle, seen, k => k, rand);

    [Fact]
    public void RepeatCyclesListSongOff()
    {
        Assert.Equal(["all", "one", "off"], new[] { "off", "all", "one" }.Select(QueueOps.NextRepeat));
        Assert.Equal("all", QueueOps.NextRepeat(null));
    }

    [Fact]
    public void WithoutShuffleAdvancesAndOnlyWrapsWhenRepeatingTheList()
    {
        var q = Mk(3);
        Assert.Equal(1, Pick(q, 0).Index);
        Assert.Equal(-1, Pick(q, 2).Index);
        Assert.Equal(0, Pick(q, 2, "all").Index);
        Assert.Equal(-1, Pick(q, 2, "one").Index);   // «repetir canción» lo gestiona el final de la canción, no el botón siguiente
        Assert.Equal(-1, Pick([], 0).Index);
    }

    [Fact]
    public void ShuffleDoesNotRepeatUntilAllPlayedAndHonoursRepeatAll()
    {
        var q = Mk(5);
        var seen = new List<string>(); var idx = 0; var heard = new HashSet<int> { 0 };
        for (var i = 0; i < 4; i++)
        {
            var r = Pick(q, idx, "off", true, seen);
            Assert.True(r.Index >= 0 && !heard.Contains(r.Index));
            heard.Add(r.Index); idx = r.Index; seen = r.Seen;
        }
        Assert.Equal(5, heard.Count);
        Assert.Equal(-1, Pick(q, idx, "off", true, seen).Index);          // todas sonadas: se acaba
        var again = Pick(q, idx, "all", true, seen);
        Assert.True(again.Index >= 0 && again.Index != idx);               // con repetir lista, vuelve a empezar
        Assert.Equal([q[idx]], again.Seen);
        Assert.Equal(4, Pick(q, 0, "off", true, null, () => 0.999).Index); // el azar elige entre las que faltan
        Assert.Equal(0, Pick(Mk(1), 0, "all", true).Index);                // una sola canción
    }

    [Fact]
    public void SettingsNormalizeRepeat()
    {
        var s = new AppSettings { Repeat = "nada" };
        s.Normalize();
        Assert.Equal("off", s.Repeat);
        s.Repeat = "one"; s.Normalize();
        Assert.Equal("one", s.Repeat);
    }
}
