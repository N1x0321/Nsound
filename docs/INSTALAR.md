# Cómo instalar Nsound

Nsound es gratuita y no tiene cuentas ni suscripciones. Los paquetes no están firmados por una tienda
(Microsoft Store, Google Play, App Store), así que cada sistema te pedirá una confirmación al instalar.
Es normal: no significa que haya nada raro, sino que la app no pasa por una tienda.

**Dónde conseguirlos:** en la página de [Releases](https://github.com/N1x0321/Nsound/releases) (la última beta aparece arriba) o en la pestaña *Actions* → ejecución de «Build Android APK» / «Build unsigned IPA» / «Build Windows app»
→ *Artifacts* (hace falta sesión iniciada en GitHub).

**Comprobar que el archivo no está alterado (opcional):** cada paquete trae un `.sha256`.
En Windows: `Get-FileHash .\archivo -Algorithm SHA256` y compara el resultado con el del `.sha256`.

---

## Actualizar

Desde la beta 11, Nsound avisa dentro de la app cuando hay una versión nueva; nunca instala nada sin preguntarte.
Las betas anteriores no avisan: hay que instalar la 11 o una posterior a mano una vez.

- **Windows con instalador:** pulsa **«Actualizar ahora»** en el aviso. Nsound descarga el instalador, comprueba su huella SHA-256,
  te pide confirmación, se cierra, se actualiza y vuelve a abrirse. Si algo falla no instala nada y ofrece **«Descargar a mano»**.
- **Windows con zip portable:** «Descargar» abre la página de la descarga. Cierra Nsound, extrae el zip nuevo y ábrelo (puedes borrar
  la carpeta antigua). Si prefieres que en adelante se actualice solo, instala el `.exe` una vez: tu biblioteca se conserva.
- **Android:** abre el APK nuevo encima del instalado.
- **iPhone:** actualiza desde SideStore / AltStore si añadiste la fuente de Nsound, o instala el `.ipa` nuevo encima con el mismo Apple ID.

## Windows 10 / 11

Necesitas: Windows 10 (1809) o superior y el *WebView2 Runtime* (ya viene con Windows 11 y con Windows 10 actualizado;
el instalador lo descarga de Microsoft si falta).

**¿Qué archivo es el tuyo?** *Configuración → Sistema → Información → «Tipo de sistema»*:

| Tu Windows | Archivos terminados en |
|---|---|
| 64 bits, procesador x64 (Intel o AMD: casi todos los PC) | `-windows-x64-setup.exe` o `-windows-x64.zip` |
| Procesador ARM (Snapdragon y similares) | `-windows-arm64-setup.exe` o `-windows-arm64.zip` |
| 32 bits | `-windows-x86-setup.exe` o `-windows-x86.zip` |

Los instaladores y los archivos de 32 bits están **a partir de la primera versión publicada con instalador** (la beta 11 solo trae
los zip de x64 y ARM64). En 32 bits el tono se calcula con un método más sencillo que en 64 bits y el BPM funciona igual.

### Opción A: instalador (recomendada: se actualiza solo)

1. Descarga `Nsound-<versión>-windows-<tu tipo>-setup.exe` (un solo archivo).
2. Ábrelo. Si aparece *«Windows protegió su PC»*: **Más información → Ejecutar de todas formas** (el programa no está firmado).
3. Sigue los pasos. Se instala solo para tu usuario, **sin permisos de administrador**, con acceso en el menú Inicio y, si quieres, en el escritorio.

Para desinstalar: *Configuración → Aplicaciones → Nsound → Desinstalar*. Tus datos no se borran.

### Opción B: zip portable (sin instalar)

1. Descarga `Nsound-<versión>-windows-<tu tipo>.zip`.
2. **Extrae todo el contenido** del zip en una carpeta (clic derecho → *Extraer todo*). No lo ejecutes desde dentro del zip.
3. Abre **Abrir Nsound** (o el archivo `Nsound.exe` de la carpeta `app`).
4. Si aparece *«Windows protegió su PC»*: pulsa **Más información → Ejecutar de todas formas**
   (SmartScreen avisa porque el programa no está firmado).

No necesita instalador ni permisos de administrador. Para desinstalar, borra la carpeta.

### En los dos casos

- **Seguir en segundo plano** (*Ajustes → Reproducción*, viene desactivado): al cerrar la ventana la música sigue y Nsound se queda
  junto al reloj, a veces dentro de los *iconos ocultos* (la flecha `^`). Un clic en el icono vuelve a abrirlo; botón derecho →
  **Salir de Nsound** lo cierra del todo.
- **Búsquedas recientes:** al pinchar en *Buscar* salen las últimas 10 que hayas usado (al pulsar Intro o al reproducir un resultado).
  Se guardan solo en tu PC y se pueden borrar desde la misma lista.
- **Ecualizador** (*Ajustes*): apagado no procesa el sonido; encendido gasta algo más de procesador. Si el equipo se calienta, apágalo.
- Tus datos (biblioteca, listas, ajustes) están en `%LocalAppData%\LibreStream`.
- Las descargas van por defecto a `Vídeos\LibreStream` (se cambia en *Ajustes*).
- Si algo falla, mira `%LocalAppData%\LibreStream\crash.log` y cuéntalo.

## Android 7 o superior

1. Descarga `Nsound-<versión>-android.apk` en el móvil (o pásalo desde el PC por cable, Drive, etc.).
2. Ábrelo. Android te pedirá permitir instalar apps desde esa fuente (el navegador o el gestor de archivos que uses):
   **Ajustes → Permitir de esta fuente**. Es un permiso que puedes quitar después.
3. Si Google Play Protect dice *«App no verificada»* o *«Bloqueada»*: pulsa **Más detalles → Instalar de todas formas**
   (el APK no pasa por Play Store: va firmado con la clave propia del proyecto).
4. Pulsa **Instalar** y luego **Abrir**.

> **Si tienes la beta 10 o una anterior**, la beta 11 no se instala encima («No se ha instalado la aplicación»). Antes de desinstalarla,
> **exporta tu biblioteca** (Biblioteca → Exportar); después instala la nueva e importa el archivo. Solo pasa esta vez.

Para desinstalar: mantén pulsado el icono → *Desinstalar*. Se borra también la biblioteca y las descargas de la app.

> Necesita que el **Android System WebView** y **Chrome** estén actualizados (Play Store → Mis apps).

## iPhone / iPad (iOS 16 o superior)

El `.ipa` **no está firmado**: iOS no permite instalarlo directamente. Hay que firmarlo con tu Apple ID al instalar.
Elige **una** de estas formas:

### Opción A: Sideloadly (Windows o Mac, la más sencilla)
1. Instala [Sideloadly](https://sideloadly.io) en el ordenador (en Windows necesitas iTunes y iCloud de Apple.com, **no** de la Microsoft Store).
2. Conecta el iPhone por cable y pulsa **Confiar** en el teléfono.
3. Abre Sideloadly, arrastra el `.ipa` y escribe tu Apple ID. Pulsa **Start**.
4. En el iPhone: **Ajustes → General → VPN y gestión de dispositivos →** tu Apple ID **→ Confiar**.
5. iOS 16 o superior: **Ajustes → Privacidad y seguridad → Modo desarrollador → Activar** (pide reiniciar).
6. Abre Nsound.

### Opción B: SideStore (se renueva sola, sin ordenador) — la recomendada para no reinstalar cada semana
SideStore es una tienda de código abierto que firma y **renueva la app en el propio iPhone**.
1. Instala SideStore siguiendo su guía oficial: <https://docs.sidestore.io> (el primer arranque necesita un ordenador, solo una vez).
2. En el iPhone, descarga el `.ipa` de Nsound. Ábrelo con **SideStore** (menú Compartir → SideStore) o, dentro de SideStore, **My Apps → +** y elígelo.
3. SideStore renueva la firma antes de que caduque. Para renovar necesita su VPN local activada (la guía de SideStore explica cuál) y que abras SideStore de vez en cuando.
4. Con un Apple ID gratuito sigue habiendo el límite de **3 apps** y el de 7 días: la diferencia es que la renovación es automática.

### Opción C: AltStore (renueva por wifi con el ordenador)
Instala [AltStore](https://altstore.io) en el ordenador (AltServer) y en el iPhone, abre AltStore → **My Apps → +** y elige el `.ipa`.
Mientras el ordenador esté encendido y en la misma wifi, AltStore renueva la firma solo.

### Opción D: TrollStore (permanente, solo en algunos iOS)
TrollStore instala sin que caduque nunca, pero **solo funciona en ciertas versiones de iOS**: desde la 14.0 hasta la 16.6.1,
la 16.7 RC (20H18) y la 17.0. En versiones más nuevas no se puede usar; no actualices el iPhone si quieres conservarlo.
Instálalo con su guía oficial: <https://ios.cfw.guide/installing-trollstore/>. Después, abre el `.ipa` con TrollStore (Compartir → TrollStore) y pulsa **Install**.

### ¿Cuál elijo?

| Opción | ¿Se renueva sola? | Necesita ordenador | Funciona en |
|---|---|---|---|
| A. Sideloadly | No (cada 7 días a mano) | Sí, cada vez | iOS 16+ |
| **B. SideStore** | **Sí, en el iPhone** | Solo para instalar SideStore | iOS 16+ |
| C. AltStore | Sí, con el ordenador en la misma wifi | Sí, encendido | iOS 16+ |
| D. TrollStore | No hace falta: no caduca | Solo para instalar TrollStore | iOS 14.0–16.6.1 y 17.0 |

**Tiendas con certificados «empresariales» (ESign, Scarlet…):** no se recomiendan. Apple revoca esos certificados de golpe
y la app deja de abrirse, y pasas tus datos por terceros que no controlas.

**Limitaciones con Apple ID gratuito (opciones A, B y C):** la firma **caduca a los 7 días** y puedes tener como máximo
3 apps firmadas así a la vez. Los datos se conservan si reinstalas encima.

> **Fuente de Nsound:** en SideStore o AltStore, añade esta fuente y Nsound se instala y se actualiza desde ahí:
> `https://n1x0321.github.io/Nsound/source.json`

---

## Qué esperar en el móvil (versión de pruebas)

- Las apps móviles se han probado en móviles reales y en un emulador, pero es una versión de pruebas:
  puede haber fallos. Si ves uno, apunta en qué pantalla estabas y qué texto de error aparece.
- Si YouTube no devuelve resultados, la pantalla muestra el motivo en rojo.

### Segundo plano y pantalla bloqueada (iPhone y Android)

- **Micro pausa al salir o bloquear.** Al salir de la app, apagar la pantalla o desbloquear, el sistema puede pausar por un instante el reproductor
  de YouTube (va incrustado y el sistema lo trata como un vídeo). Nsound lo reanuda solo con varios intentos seguidos, así que puede notarse
  un corte de aproximadamente un segundo. Es una limitación del sistema con el reproductor oficial de YouTube, no un fallo que se pueda quitar del todo.
- **Si pausas tú, no se reanuda.** Lo que pausas en la app, en la pantalla de bloqueo o con los cascos se respeta.
- **iPhone: la pantalla de bloqueo en pausa.** Mientras suena, el reproductor de la pantalla de bloqueo lo da YouTube; en pausa lo sostiene la propia
  app con el título, la portada y los botones de anterior y siguiente. Si la música lleva **mucho rato en pausa** y el móvil bloqueado, **iOS cierra la
  app** para ahorrar batería (la deja dormida y luego la termina): entonces el reproductor desaparece o los botones tardan, y hay que abrir Nsound para seguir.
  Esto lo decide iOS y no se puede evitar con una app que no es de la tienda.
- **Android y la batería de cada fabricante:** en Oppo/Realme/OnePlus (ColorOS), Xiaomi, Vivo, Huawei y a veces Samsung, el sistema cierra las apps en segundo plano aunque suene música. Nsound trae en **Ajustes → «Música en segundo plano (Android)»** un asistente que detecta tu móvil, pide quitar la restricción de batería y abre las pantallas de «inicio automático» del fabricante, con los pasos para tu modelo. Los nombres de los menús cambian según el modelo y la versión; hay más información en <https://dontkillmyapp.com>.
- **Android:** una notificación de reproducción mantiene la música con la pantalla apagada. Si cierras Nsound desde las apps recientes, se para a propósito.
  Algunos móviles con ahorro de batería agresivo pueden cerrarla igualmente: en ese caso quita la restricción de batería para Nsound.
- El **ecualizador** (*Ajustes*) está en las apps de Android e iPhone y viene apagado; en el navegador no está disponible. Apagado o en
  «Plano» no toca el sonido, y al apagarlo el reproductor se rehace y queda como si no se hubiera usado. Se ha probado en un Android 15
  (sigue sonando fuera de la app y con la pantalla apagada); en otros móviles puede gastar más batería o cortarse, y **en iPhone no está
  probado**: iOS puede parar la música al salir o bloquear mientras está encendido. Si pasa, apágalo.
- Las **descargas sin conexión** son lo menos probado.
- YouTube no se descarga: solo se reproduce con su reproductor oficial. Las descargas son del contenido libre
  (Creative Commons).
