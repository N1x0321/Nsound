using System.Globalization;

namespace LibreStream.Core;

/// <summary>Paleta de un estilo de la interfaz. Los mismos estilos existen en la interfaz web (iOS/Android) con estos colores.</summary>
public sealed record ThemePalette(string Id, string Name, bool Dark, string Bg, string Surface, string Accent, string Accent2, string Blue, string On);

public static class Themes
{
    public const string Default = "nsound";
    public const string CustomId = "custom";
    public const string CustomName = "Tu color";

    public static readonly ThemePalette[] All =
    [
        new("nsound", "Nsound", true, "#0B0C10", "#14161D", "#FF4D62", "#D6233F", "#3B82F6", "#FFFFFF"),
        new("neon", "Neón", true, "#07060D", "#110D20", "#FF2BD6", "#A21CAF", "#22D3EE", "#FFFFFF"),
        new("oceano", "Océano", true, "#05111B", "#0C1B2A", "#2DD4BF", "#0891B2", "#38BDF8", "#042F2E"),
        new("atardecer", "Atardecer", true, "#130B0D", "#1F1214", "#FF8A3D", "#E11D74", "#A855F7", "#2A1000"),
        new("amoled", "AMOLED", true, "#000000", "#0B0B0D", "#FF4D62", "#D6233F", "#3B82F6", "#FFFFFF"),
        new("claro", "Claro", false, "#F4F5F8", "#FFFFFF", "#E11D48", "#BE123C", "#2563EB", "#FFFFFF"),
        new("clasico", "Clásico", true, "#121214", "#101014", "#FF6B6B", "#E5465C", "#3B82F6", "#1A0505"),
    ];

    /// <summary>Nombres para la lista de estilos: los fijos y, al final, «Tu color».</summary>
    public static IReadOnlyList<string> Names => [.. All.Select(t => t.Name), CustomName];

    /// <summary>El estilo con ese id, o el predeterminado si no existe.</summary>
    public static ThemePalette Find(string? id) => All.FirstOrDefault(t => t.Id == id) ?? All[0];

    /// <summary>El estilo con ese id; «custom» se construye con el color elegido (si no es válido, el predeterminado).</summary>
    public static ThemePalette Resolve(string? id, string? customAccent) =>
        id == CustomId && TryParseHex(customAccent, out _) ? Custom(customAccent!) : Find(id);

    /// <summary>«#RRGGBB» (o «RRGGBB») válido → componentes. Cualquier otra cosa devuelve false.</summary>
    public static bool TryParseHex(string? hex, out (byte R, byte G, byte B) rgb)
    {
        rgb = default;
        var s = (hex ?? "").Trim().TrimStart('#');
        if (s.Length != 6 || !int.TryParse(s, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var v)) return false;
        rgb = ((byte)(v >> 16), (byte)(v >> 8), (byte)v);
        return true;
    }

    public static string ToHex((byte R, byte G, byte B) c) => $"#{c.R:X2}{c.G:X2}{c.B:X2}";

    /// <summary>Normaliza a «#RRGGBB» en mayúsculas, o null si no es un color válido.</summary>
    public static string? NormalizeHex(string? hex) => TryParseHex(hex, out var c) ? ToHex(c) : null;

    private static double Linear(byte v) { var c = v / 255.0; return c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4); }

    private static double Luminance((byte R, byte G, byte B) c) => 0.2126 * Linear(c.R) + 0.7152 * Linear(c.G) + 0.0722 * Linear(c.B);

    /// <summary>Relación de contraste entre dos colores (WCAG): 1 = igual, 21 = blanco sobre negro.</summary>
    public static double Contrast((byte R, byte G, byte B) a, (byte R, byte G, byte B) b)
    {
        var (hi, lo) = (Math.Max(Luminance(a), Luminance(b)), Math.Min(Luminance(a), Luminance(b)));
        return (hi + 0.05) / (lo + 0.05);
    }

    /// <summary>Texto blanco u oscuro, el que mejor se lee sobre ese color (para los botones de acento).</summary>
    public static string ReadableOn((byte R, byte G, byte B) background)
    {
        var white = (R: (byte)255, G: (byte)255, B: (byte)255);
        var dark = (R: (byte)0x16, G: (byte)0x10, B: (byte)0x10);
        return Contrast(background, white) >= Contrast(background, dark) ? "#FFFFFF" : "#161010";
    }

    private static (double H, double S, double L) ToHsl((byte R, byte G, byte B) c)
    {
        double r = c.R / 255.0, g = c.G / 255.0, b = c.B / 255.0;
        double max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b)), l = (max + min) / 2, d = max - min;
        if (d == 0) return (0, 0, l);
        var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        var h = max == r ? (g - b) / d + (g < b ? 6 : 0) : max == g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60, s, l);
    }

    private static (byte R, byte G, byte B) FromHsl(double h, double s, double l)
    {
        double C = (1 - Math.Abs(2 * l - 1)) * s, X = C * (1 - Math.Abs(h / 60 % 2 - 1)), m = l - C / 2;
        var (r, g, b) = h < 60 ? (C, X, 0d) : h < 120 ? (X, C, 0d) : h < 180 ? (0d, C, X) : h < 240 ? (0d, X, C) : h < 300 ? (X, 0d, C) : (C, 0d, X);
        byte B8(double v) => (byte)Math.Round(Math.Clamp((v + m) * 255, 0, 255));
        return (B8(r), B8(g), B8(b));
    }

    /// <summary>
    /// Estilo oscuro a partir de un solo color: el fondo y las superficies son tonos muy oscuros de ese color. El color se ajusta lo justo
    /// (más claro u oscuro) para que dos cosas se cumplan siempre: que se vea sobre el fondo (contraste 3) y que el texto de los botones,
    /// blanco u oscuro, se lea (contraste 4,5). Con un color ya correcto no cambia nada.
    /// </summary>
    public static ThemePalette Custom(string accentHex)
    {
        TryParseHex(accentHex, out var rgb);
        var (h, s, l0) = ToHsl(rgb);
        s = Math.Max(s, 0.25);
        var tint = Math.Clamp(s, 0.2, 0.5);
        var bg = FromHsl(h, tint, 0.045);
        var accent = rgb;
        var best = double.MaxValue;
        for (var i = 20; i <= 88; i++)                       // luminosidad del 20 % al 88 %: se elige la más cercana a la elegida que cumpla
        {
            var l = i / 100.0;
            var candidate = FromHsl(h, s, l);
            ThemeFits(candidate, bg, out var fits);
            if (fits && Math.Abs(l - l0) < best) { best = Math.Abs(l - l0); accent = candidate; }
        }
        ThemeFits(rgb, bg, out var original);
        if (original) accent = rgb;                           // ya cumple: se respeta tal cual
        var accent2 = FromHsl(ToHsl(accent).H, ToHsl(accent).S, Math.Max(0.2, ToHsl(accent).L * 0.78));
        return new ThemePalette(CustomId, CustomName, true, ToHex(bg), ToHex(FromHsl(h, tint, 0.085)),
            ToHex(accent), ToHex(accent2), "#3B82F6", ReadableOn(accent));
    }

    private static void ThemeFits((byte R, byte G, byte B) accent, (byte R, byte G, byte B) bg, out bool fits)
    {
        TryParseHex(ReadableOn(accent), out var on);
        fits = Contrast(accent, bg) >= 3 && Contrast(accent, on) >= 4.5;
    }
}
