# Registro de Decisiones de Arquitectura (ADR)
**Proyecto:** REA-iPad-Agentic-IDE  
**Fecha:** 2026-10-30

---

## ADR-001: Selección de Monaco Editor como motor de edición central

- **Estado:** Aceptado
- **Fecha:** 2026-10-30
- **Decisores:** Equipo de Arquitectura REA

### Contexto
Para ofrecer una experiencia de edición idéntica a VS Code en el iPad, se evaluaron dos motores líderes en la web: Monaco Editor (el motor nativo de VS Code) y CodeMirror 6.

### Decisión
Se elige **Monaco Editor** porque garantiza el 100% de compatibilidad con las extensiones de lenguaje, modelos de tokens, atajos de VS Code y capacidades de diff visual integrado. Se incorpora una capa de ajuste táctil para resolver el soporte de gestos en iPadOS.

### Consecuencias
- **Positivas:** Misma interfaz, paleta de comandos, minimapa y autocompletado que VS Code.
- **Negativas:** Tamaño de bundle inicial mayor que CodeMirror, mitigado cargando Monaco vía CDN optimizado con WebWorkers asíncronos.

---

## ADR-002: File System Access API con fallback a OPFS e IndexedDB

- **Estado:** Aceptado
- **Fecha:** 2026-10-30

### Contexto
Un IDE en iPad debe permitir trabajar tanto con carpetas reales del sistema de archivos local (`On My iPad`, iCloud Drive, pendrives USB-C) como en entornos sandbox donde la API no esté disponible o se niegue el permiso.

### Decisión
Se implementa una interfaz unificada `FileSystemProvider` con dos implementaciones:
1. **Nativo Local:** `showDirectoryPicker()` para acceso directo al disco del iPad / PC.
2. **Fallback Sandbox:** Origin Private File System (OPFS) / IndexedDB para guardar proyectos en memoria persistente del navegador sin pedir permisos repetitivos.

### Consecuencias
- **Positivas:** Máxima portabilidad. En navegadores modernos (Safari/Chrome/Edge) permite abrir repositorios reales de Git clonados en el iPad.

---

## ADR-003: Arquitectura Agéntica Desacoplada compatible con MCP y Gemini

- **Estado:** Aceptado
- **Fecha:** 2026-10-30

### Contexto
Antigravity se distingue por su modo agente con planificación en bucle y soporte de herramientas Model Context Protocol (MCP). El IDE debe permitir al desarrollador conectar tanto modelos en la nube (Gemini 2.5 Flash, Pro, Argon) como servidores MCP locales o remotos.

### Decisión
Se implementa el módulo `AgentOrchestrator` como un cliente agéntico modular con:
- Bucle de razonamiento (Plan -> Tool Call -> Feedback -> Artifact).
- Renderizado de **Living Artifacts** mediante Mermaid.js y widgets interactivos.
- Adaptador plug-and-play para Gemini Interactions API / Argon y endpoints compatibles con OpenAI / Ollama.

### Consecuencias
- **Positivas:** Permite alternar entre modelos ultra-rápidos (Gemini Flash 2.5) para tareas cotidianas y modelos profundos (Gemini Pro / Argon) para refactorizaciones complejas.

---

## ADR-004: Estrategia Dual PWA Offline-First y Shell Nativo Swift / WKWebView

- **Estado:** Aceptado
- **Fecha:** 2026-10-30

### Contexto
El usuario necesita acceder al IDE de inmediato desde su iPad vía web local, pero también requiere la posibilidad de empaquetarlo como app nativa (.ipa) para distribución e instalación en iPadOS.

### Decisión
Se adopta una arquitectura basada en estándares web progresivos (PWA con Service Worker y Web App Manifest) que funciona directamente en Safari a 120Hz a pantalla completa y que, a su vez, puede ser envuelta de manera trivial en un proyecto Xcode con `WKWebView` y UIKit para generar un binario IPA nativo firmado.
