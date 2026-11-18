using LibreStream.Core;
using Windows.Media;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Storage.Streams;

namespace LibreStream.App;

/// <summary>
/// Equivalente Windows de AudioPlayerManager.swift: MediaPlayer + cola (MediaPlaybackList) +
/// SystemMediaTransportControls (overlay de volumen, teclas multimedia, pantalla de bloqueo).
/// </summary>
public sealed class AudioPlayerManager : IDisposable
{
    public static AudioPlayerManager Shared { get; } = new();

    public MediaPlayer Player { get; } = new() { AudioCategory = MediaPlayerAudioCategory.Media };
    private readonly MediaPlaybackList _list = new() { MaxPrefetchTime = TimeSpan.FromSeconds(10) };
    private List<CatalogItem> _queue = [];

    public event Action? StateChanged;
    /// <summary>Se acabó la cola nativa (sin repetir): la ventana decide qué suena después (p. ej. una canción de YouTube).</summary>
    public event Action? QueueEnded;

    private string _repeat = QueueOps.RepeatOff;
    private int _lastIndex = -1;

    /// <summary>Repetir (off/all/one) y aleatorio sobre la cola nativa; «all» y el aleatorio los hace MediaPlaybackList.</summary>
    public void SetModes(string repeat, bool shuffle)
    {
        _repeat = repeat;
        _list.AutoRepeatEnabled = repeat == QueueOps.RepeatAll;
        _list.ShuffleEnabled = shuffle;
    }
    public CatalogItem? Current =>
        _list.CurrentItemIndex < _queue.Count ? _queue[(int)_list.CurrentItemIndex] : null;
    public bool IsPlaying => Player.PlaybackSession.PlaybackState == MediaPlaybackState.Playing;
    public TimeSpan Position => Player.PlaybackSession.Position;
    public TimeSpan Duration => Player.PlaybackSession.NaturalDuration;
    public double Volume { get => Player.Volume; set => Player.Volume = Math.Clamp(value, 0, 1); }

    private AudioPlayerManager()
    {
        // MediaPlayer integra SMTC automáticamente (CommandManager habilitado por defecto).
        Player.CommandManager.IsEnabled = true;
        Player.Source = _list;
        _list.CurrentItemChanged += (_, e) =>
        {
            // Repetir la canción: al acabar una, vuelve a la misma
            if (_repeat == QueueOps.RepeatOne && e.Reason == MediaPlaybackItemChangedReason.EndOfStream && e.OldItem is { } old && _list.Items.IndexOf(old) is var i and >= 0)
                _list.MoveTo((uint)i);
            else if (e.NewItem is not null) _lastIndex = (int)_list.CurrentItemIndex;
            StateChanged?.Invoke();
        };
        Player.MediaEnded += (_, _) =>
        {
            if (_repeat == QueueOps.RepeatOne && _lastIndex >= 0 && _lastIndex < _list.Items.Count) { _list.MoveTo((uint)_lastIndex); Player.Play(); }
            else QueueEnded?.Invoke();
        };
        Player.PlaybackSession.PlaybackStateChanged += (_, _) => StateChanged?.Invoke();
        Player.MediaFailed += (_, e) => System.Diagnostics.Debug.WriteLine($"MediaFailed: {e.ErrorMessage}");
    }

    public void Play(IEnumerable<CatalogItem> items, int startAt = 0)
    {
        Player.Pause();
        _list.Items.Clear();
        _queue = [];
        foreach (var item in items)
        {
            var src = item.Sources.FirstOrDefault(s => s.IsDirectlyPlayable);
            if (src is null) continue;
            _queue.Add(item);
            _list.Items.Add(BuildPlaybackItem(item, src));
        }
        if (_queue.Count == 0) return;
        _lastIndex = Math.Clamp(startAt, 0, _queue.Count - 1);
        _list.MoveTo((uint)_lastIndex);
        Player.Play();
    }

    public void TogglePlayPause() { if (IsPlaying) Player.Pause(); else Player.Play(); }
    public void Next() => _list.MoveNext();

    public void Previous()
    {
        if (Position > TimeSpan.FromSeconds(3) || _list.CurrentItemIndex == 0) Seek(TimeSpan.Zero);
        else _list.MovePrevious();
    }

    public void Seek(TimeSpan to) => Player.PlaybackSession.Position = to < TimeSpan.Zero ? TimeSpan.Zero : to;

    private static MediaPlaybackItem BuildPlaybackItem(CatalogItem item, Source src)
    {
        var playback = new MediaPlaybackItem(MediaSource.CreateFromUri(src.Url));
        var props = playback.GetDisplayProperties();
        if (item.Kind == ItemKind.Video)
        {
            props.Type = MediaPlaybackType.Video;
            props.VideoProperties.Title = item.Title;
            props.VideoProperties.Subtitle = item.Artist;
        }
        else
        {
            props.Type = MediaPlaybackType.Music;
            props.MusicProperties.Title = item.Title;
            props.MusicProperties.Artist = item.Artist;
            props.MusicProperties.AlbumTitle = item.Album ?? "";
        }
        if (item.ArtworkUrl is not null)
            props.Thumbnail = RandomAccessStreamReference.CreateFromUri(item.ArtworkUrl);
        playback.ApplyDisplayProperties(props);
        return playback;
    }

    public void Dispose() => Player.Dispose();
}
