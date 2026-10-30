# Arquitectura C4 del Proyecto REA-iPad-Agentic-IDE
**Proyecto:** REA-iPad-Agentic-IDE  
**Fecha:** 2026-10-30

La arquitectura del sistema sigue el modelo C4 para documentar desde el contexto de alto nivel hasta la composición interna de los componentes del IDE.

---

## Nivel 1: Diagrama de Contexto de Sistema (System Context)

Muestra los usuarios que interactúan con el IDE y las conexiones externas (proveedores de modelos de IA, servidores MCP y almacenamiento del iPad).

```mermaid
graph TD
    User["Desarrollador en iPad Pro M2<br/>[Persona]"]
    IDE["REA-iPad-Agentic-IDE<br/>[Sistema de Software]"]
    FileSystem["Sistema de Archivos iPadOS / iCloud<br/>[Sistema Local]"]
    GeminiAPI["Google Gemini API (Flash 2.5, Pro, Argon)<br/>[External AI System]"]
    MCPServers["Servidores MCP (GitHub, Bases de Datos, Tools)<br/>[External Protocol Systems]"]
    LocalLLM["Motor Local Wasm / Ollama LAN<br/>[Local AI System]"]

    User -->|Interactúa mediante Touch, Magic Keyboard y Apple Pencil| IDE
    IDE -->|Lee y escribe carpetas de proyecto via File System Access API| FileSystem
    IDE -->|Envía prompts y recibe streaming de razonamiento agéntico| GeminiAPI
    IDE -->|Invoca herramientas y lee recursos via JSON-RPC| MCPServers
    IDE -->|Inferencia en dispositivo aprovechando memoria unificada M2| LocalLLM
```

---

## Nivel 2: Diagrama de Contenedores (Containers)

Descompone el IDE en sus contenedores lógicos de ejecución dentro de iPadOS.

```mermaid
graph TD
    subgraph iPadOS_Runtime ["Entorno iPadOS / Apple Silicon M2"]
        subgraph PWA_Shell ["Contenedor PWA / Standalone WebKit"]
            UI["UI Layer (Glassmorphic Interface 120Hz)<br/>[HTML5 / CSS3 / ES Modules]"]
            EditorCore["Monaco Editor Engine<br/>[Monaco Editor CDN / WebWorkers]"]
            AgentEngine["Agentic Orchestrator Engine<br/>[JavaScript Async Runtime]"]
            VirtualFS["Virtual File System Bridge<br/>[File System Access API & OPFS]"]
            TouchBar["Floating Modifier Touch Bar<br/>[Tactile Controller]"]
            TerminalCore["Virtual POSIX Terminal & Evaluator<br/>[WebWorker Evaluator]"]
        end
        NativeWrapper["Optional Swift WKWebView Native Wrapper (IPA)<br/>[Swift / UIKit / FileProvider]"]
        LocalDisk[("Carpetas Locales de Proyectos<br/>[iPadOS Files App / On My iPad]")]
    end

    UI --> EditorCore
    UI --> AgentEngine
    UI --> TouchBar
    UI --> TerminalCore
    EditorCore --> VirtualFS
    AgentEngine --> VirtualFS
    VirtualFS --> LocalDisk
    NativeWrapper -.->|Empaqueta| PWA_Shell
```

---

## Nivel 3: Diagrama de Componentes (Components)

Detalle de los módulos internos del `AgentEngine` y del `EditorCore`.

```mermaid
graph TD
    subgraph Agentic_Engine ["Módulo Agente Antigravity"]
        Planner["Planner & Task Scheduler"]
        ContextManager["Context & Memory Window"]
        ModelAdapter["Model API Adapter (Gemini, Argon, Custom)"]
        ToolManager["Tool Registry & MCP Client"]
        ArtifactsGen["Artifacts & Mermaid Visualizer"]
        
        Planner --> ContextManager
        Planner --> ModelAdapter
        Planner --> ToolManager
        Planner --> ArtifactsGen
    end

    subgraph Editor_Engine ["Módulo Editor & Workspace"]
        TabManager["Multi-Tab Manager"]
        SyntaxLSP["Syntax & Language Providers"]
        FileTree["Reactive File Tree Explorer"]
        CommandPalette["Command Palette (Cmd+P / Cmd+Shift+P)"]
        
        TabManager --> SyntaxLSP
        FileTree --> TabManager
        CommandPalette --> TabManager
    end

    AgentEngine --> Agentic_Engine
    EditorCore --> Editor_Engine
    Agentic_Engine -->|Modifica archivos y consulta código| Editor_Engine
```
