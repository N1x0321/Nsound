namespace LibreStream.Core;

/// <summary>
/// Color de una portada para teñir la interfaz (brillo de fondo, barra, mini reproductor): el tono más vivo y abundante de la imagen,
/// no la media (que con portadas variadas sale marrón o gris).
/// </summary>
public static class ArtPalette
{
    private const int Bins = 18;   // tramos de 20° de tono

    /// <summary>
    /// Píxeles BGRA (4 bytes por píxel, p. ej. una miniatura reducida a 24×24) → color dominante vivo, o null si la imagen es casi gris.
    /// Cada píxel pesa por su saturación y por estar lejos del negro y del blanco; gana el tramo de tono con más peso.
    /// </summary>
    public static (byte R, byte G, byte B)? Vibrant(ReadOnlySpan<byte> bgra)
    {
        var weight = new double[Bins];
        var sumR = new double[Bins]; var sumG = new double[Bins]; var sumB = new double[Bins];
        double total = 0;
        for (var i = 0; i + 3 < bgra.Length; i += 4)
        {
            if (bgra[i + 3] < 128) continue;   // transparente
            var c = (R: bgra[i + 2], G: bgra[i + 1], B: bgra[i]);
            var (h, s, l) = Themes.ToHsl(c);
            if (l < 0.1 || l > 0.93) continue;
            var w = s * s * (1 - Math.Abs(2 * l - 1));
            if (w <= 0.02) continue;
            var bin = (int)(h / (360.0 / Bins)) % Bins;
            weight[bin] += w; sumR[bin] += c.R * w; sumG[bin] += c.G * w; sumB[bin] += c.B * w;
            total += w;
        }
        if (total < 0.5) return null;
        var best = 0;
        for (var b = 1; b < Bins; b++)
            if (weight[b] > weight[best]) best = b;
        return ((byte)(sumR[best] / weight[best]), (byte)(sumG[best] / weight[best]), (byte)(sumB[best] / weight[best]));
    }

    /// <summary>El mismo tono, con saturación y luz de «brillo»: se ve bien sobre fondo oscuro y no deslumbra.</summary>
    public static (byte R, byte G, byte B) Glow((byte R, byte G, byte B) c)
    {
        var (h, s, _) = Themes.ToHsl(c);
        return Themes.FromHsl(h, Math.Clamp(s, 0.6, 0.9), 0.55);
    }
}
