# Guía de Despliegue y Uso en iPad Pro M2
**Proyecto:** REA-iPad-Agentic-IDE  
**Fecha:** 2026-10-30

Esta guía explica paso a paso cómo ejecutar, instalar como PWA y opcionalmente empaquetar nativamente el IDE para tu iPad Pro M2.

---

## 1. Acceso en Red Local (Vía Wi-Fi / LAN desde tu PC XAMPP)

1. **Obtener la dirección IP local de tu PC:**
   - Abre un terminal en tu PC y escribe `ipconfig` (ej: `192.168.1.50`).
2. **Abrir en Safari en el iPad Pro M2:**
   - En Safari en tu iPad, navega a:
     ```
     http://<IP-DE-TU-PC>/REA/REA-iPad-Agentic-IDE/
     ```
3. **Instalación como App PWA en la Pantalla de Inicio:**
   - En Safari, pulsa el botón de **Compartir** (icono con flecha hacia arriba).
   - Selecciona **"Añadir a pantalla de inicio"** (Add to Home Screen).
   - Nómbrala **REA IDE**.
   - ¡Listo! Al abrirla desde la pantalla de inicio se ejecutará a pantalla completa (Full Screen Standalone), sin barras del navegador, con soporte para 120Hz ProMotion.

---

## 2. Apertura y Edición de Carpetas Locales en iPadOS

1. Abre el IDE (como PWA o en el navegador).
2. En la barra lateral izquierda, pulsa en el botón **"Abrir Carpeta"**.
3. Se abrirá el selector del sistema de archivos de iPadOS (`Archivos` / `Files`).
4. Selecciona cualquier carpeta ubicada en:
   - **En mi iPad** (carpetas locales de proyectos).
   - **iCloud Drive** (proyectos sincronizados).
   - Memorias USB-C conectadas directamente al puerto Thunderbolt del iPad Pro M2.
5. Concede permiso de lectura y escritura al navegador cuando iPadOS lo solicite.
6. A partir de ese momento, todas las ediciones que hagas en Monaco Editor se guardan instantáneamente en tus archivos reales.

---

## 3. Uso del Modo Agente Antigravity en iPad

1. Pulsa en el icono de **Agente** (o la pestaña flotante de IA) para abrir el panel lateral de asistencia.
2. Selecciona tu modelo preferido en el selector:
   - **Gemini 2.5 Flash:** Para autocompletado y tareas de edición rápida de código.
   - **Gemini Pro / Argon:** Para planificación de arquitectura, deconstrucción o refactorizaciones complejas.
   - **Ollama / Local:** Para conexión a modelos locales ejecutándose en tu red.
3. El agente dispone de herramientas para:
   - Analizar el árbol de archivos.
   - Proponer cambios con diff visual.
   - Generar diagramas Mermaid interactivos (Living Artifacts).

---

## 4. Empaquetado Nativo como App iPadOS (.ipa)

Si deseas compilar la aplicación como un binario nativo independiente para instalar vía TestFlight, Sideloadly, AltStore o Xcode:

1. **Estructura Swift WKWebView:**
   Crea un proyecto en Xcode para iOS/iPadOS seleccionando **App** (Swift / SwiftUI o UIKit).
2. **Configuración de ViewController:**
   ```swift
   import UIKit
   import WebKit

   class IDEViewController: UIViewController, WKUIDelegate {
       var webView: WKWebView!

       override func loadView() {
           let webConfig = WKWebViewConfiguration()
           webConfig.allowsInlineMediaPlayback = true
           webView = WKWebView(frame: .zero, configuration: webConfig)
           webView.uiDelegate = self
           view = webView
       }

       override func viewDidLoad() {
           super.viewDidLoad()
           if let url = URL(string: "http://<TU-IP-O-HOST>/REA/REA-iPad-Agentic-IDE/") {
               webView.load(URLRequest(url: url))
           }
       }
   }
   ```
3. **Capabilities recomendadas en Xcode:**
   - Habilitar `Supports Document Browser` y `File Provider Storage` si deseas acceso nativo extendido.
