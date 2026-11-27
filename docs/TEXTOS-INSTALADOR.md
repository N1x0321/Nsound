# Textos preparados: instalador de Windows

**Todavía no se publican.** Actívalos solo cuando exista una Release con los instaladores (`…-windows-<arch>-setup.exe`):
hasta entonces los enlaces darían error. Sustituye `<versión>` por la publicada (por ejemplo `0.8.0-beta.12`) y `<N>` por el número de beta.

Antes de activarlos, comprueba en la Release que están los 12 ficheros de Windows y prueba en un PC el instalador y, desde la
versión anterior instalada, el botón «Actualizar ahora». Después, borra este archivo y su enlace en [DESARROLLO.md](DESARROLLO.md).

## README.md

### Fila de Windows de la tabla «Descargar»

Sustituye la fila **Windows 10 / 11** por:

```markdown
| **Windows 10 / 11** | [`Nsound-<versión>-windows-x64-setup.exe`](https://github.com/N1x0321/Nsound/releases/download/v<versión>/Nsound-<versión>-windows-x64-setup.exe) | Un solo archivo: ábrelo e instala. Se actualiza desde la propia app. Otros equipos: [ARM64](https://github.com/N1x0321/Nsound/releases/download/v<versión>/Nsound-<versión>-windows-arm64-setup.exe) · [32 bits](https://github.com/N1x0321/Nsound/releases/download/v<versión>/Nsound-<versión>-windows-x86-setup.exe). Sin instalar: [zip portable](https://github.com/N1x0321/Nsound/releases/download/v<versión>/Nsound-<versión>-windows-x64.zip). |
```

### Lista «Qué puedes hacer»

Sustituye «Aviso de versiones nuevas» por:

```markdown
- 🔔 **Aviso de versiones nuevas** dentro de la app; en Windows instalado, **«Actualizar ahora»** la pone al día.
```

### «Empezar en 3 pasos», paso 2

```markdown
2. **Instálalo** siguiendo la [guía](docs/INSTALAR.md) (en Windows, abrir el instalador).
```

## site/index.html

### Tarjeta de descarga de Windows (sección `#instalar`)

Sustituye la tarjeta «Windows (x64)» por esta y pon el tamaño real del `.exe`:

```html
<a class="card" href="https://github.com/N1x0321/Nsound/releases/download/v<versión>/Nsound-<versión>-windows-x64-setup.exe"><div class="ic"><svg><use href="#i-dl"/></svg></div><h3>Windows (x64)</h3><p>Instalador · TAMAÑO MB · se actualiza desde la app</p></a>
```

En la tarjeta «Todas las descargas», cambia el texto por:

```html
<p>ARM64, 32 bits, zip portable, sumas de control y notas · beta <N></p>
```

### Pestaña «Windows» de las instrucciones

Sustituye la lista y la nota de debajo por (conserva el `<div>` y sus atributos tal como están):

```html
<ol><li>Necesitas Windows 10 (1809) o superior.</li>
<li>Descarga el instalador <code>…-setup.exe</code> de Nsound y ábrelo.</li>
<li>Si sale «Windows protegió su PC»: <b>Más información → Ejecutar de todas formas</b>. Es normal: la app no está firmada.</li>
<li>Sigue los pasos y abre Nsound. No necesita permisos de administrador.</li></ol>
<p class="hint">Para actualizar, pulsa <b>«Actualizar ahora»</b> en el aviso de la app: tu biblioteca se conserva. Para desinstalar: Configuración → Aplicaciones. ¿Prefieres no instalar? Descarga el <code>.zip</code>, extrae todo y abre «Abrir Nsound».</p>
```

(La respuesta «Windows dice “protegió su PC”» de la sección de ayuda sigue valiendo.)

## Notas de esa Release

> **Windows:** ahora hay un instalador de un solo archivo. Si usabas el zip, instala el `.exe` una vez (tu biblioteca se conserva) y,
> desde la siguiente versión, Nsound se actualizará con el botón «Actualizar ahora». Después puedes borrar la carpeta antigua.
