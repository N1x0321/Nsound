using System.Text.RegularExpressions;

namespace LibreStream.Core;

/// <summary>Versión publicada (etiqueta «v0.8.0-beta.11»), comparada como en SemVer: beta.9 &lt; beta.10 &lt; final.</summary>
public sealed partial class ReleaseVersion : IComparable<ReleaseVersion>
{
    private readonly int[] _numbers;
    private readonly string[] _pre;

    private ReleaseVersion(string text, int[] numbers, string[] pre)
    {
        Text = text;
        _numbers = numbers;
        _pre = pre;
    }

    /// <summary>La versión sin la «v» inicial ni los datos de compilación («+commit»).</summary>
    public string Text { get; }

    /// <summary>Compilación de desarrollo («0.0.0-dev»): no se avisa de versiones nuevas.</summary>
    public bool IsDevelopment => _pre.Contains("dev");

    [GeneratedRegex(@"^v?(?<v>[0-9]+\.[0-9]+\.[0-9]+(-(?<pre>[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?)(\+[0-9A-Za-z.-]+)?\z")]
    private static partial Regex Pattern();

    public static ReleaseVersion? Parse(string? text)
    {
        var m = Pattern().Match(text?.Trim() ?? "");
        if (!m.Success) return null;
        var version = m.Groups["v"].Value;
        var core = version.Split('-')[0].Split('.');
        var numbers = new int[3];
        for (var i = 0; i < 3; i++)
            if (!int.TryParse(core[i], out numbers[i])) return null;
        var pre = m.Groups["pre"];
        return new ReleaseVersion(version, numbers, pre.Success ? pre.Value.Split('.') : []);
    }

    public int CompareTo(ReleaseVersion? other)
    {
        if (other is null) return 1;
        for (var i = 0; i < 3; i++)
            if (_numbers[i] != other._numbers[i]) return _numbers[i].CompareTo(other._numbers[i]);
        // La final va después de todas sus versiones previas
        if (_pre.Length == 0 || other._pre.Length == 0) return other._pre.Length.CompareTo(_pre.Length);
        for (var i = 0; i < Math.Min(_pre.Length, other._pre.Length); i++)
        {
            var c = ComparePart(_pre[i], other._pre[i]);
            if (c != 0) return c;
        }
        return _pre.Length.CompareTo(other._pre.Length);
    }

    /// <summary>Las partes numéricas se comparan como números y van antes que las de texto.</summary>
    private static int ComparePart(string a, string b)
    {
        bool na = a.All(char.IsAsciiDigit), nb = b.All(char.IsAsciiDigit);
        if (na != nb) return na ? -1 : 1;
        if (na)
        {
            a = a.TrimStart('0');
            b = b.TrimStart('0');
            if (a.Length != b.Length) return a.Length.CompareTo(b.Length);
        }
        return Math.Sign(string.CompareOrdinal(a, b));
    }

    public override string ToString() => Text;
}
