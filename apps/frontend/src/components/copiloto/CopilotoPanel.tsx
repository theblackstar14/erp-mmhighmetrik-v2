import { Send, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useCopilotoStore } from './copiloto-store.js';
import { cn } from '@/lib/utils.js';

const MOCK_RESPONSES: Record<string, string[]> = {
  dashboard: [
    'Veo que aún no tienes proyectos registrados. ¿Quieres que te guíe en crear el primero?',
    'Una vez tengas data, puedo analizar tu cartera global y sugerirte mejoras de margen.',
  ],
  proyectos: [
    'En esta página puedes ver y gestionar todos tus proyectos. ¿Necesitas ayuda buscando uno específico?',
    'Para crear un proyecto, click en el botón "Nuevo proyecto" arriba a la derecha.',
  ],
  proyectoDetail: [
    'Estoy mirando el detalle del proyecto. Puedo analizar avances, costos, y sugerir acciones.',
    '¿Quieres que revise el cronograma vs avance real para detectar atrasos?',
  ],
  contabilidad: [
    'En Contabilidad puedes generar el PLE SUNAT del Libro Diario y Mayor cuando lo necesites.',
    '¿Te ayudo a revisar asientos pendientes de validar?',
  ],
  default: [
    '¡Hola! Soy Copiloto · tu asistente para el ERP. ¿En qué puedo ayudarte?',
    'Puedo responder preguntas sobre tus proyectos, valorizaciones, contabilidad o ayudarte a navegar el sistema.',
  ],
};

function getContextKey(pathname: string, projectId?: string): string {
  if (projectId) return 'proyectoDetail';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/proyectos')) return 'proyectos';
  if (pathname.startsWith('/contabilidad')) return 'contabilidad';
  return 'default';
}

export function CopilotoPanel() {
  const { isOpen, close, messages, addMessage, clearMessages } = useCopilotoStore();
  const location = useLocation();
  const params = useParams();
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mensaje de bienvenida contextual al abrir
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const ctx = getContextKey(location.pathname, params.id);
      const greeting = MOCK_RESPONSES[ctx]![0]!;
      addMessage({ role: 'assistant', content: greeting });
    }
  }, [isOpen, messages.length, location.pathname, params.id, addMessage]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const send = () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    addMessage({ role: 'user', content: userMsg });
    setInput('');
    setThinking(true);

    // Mock respuesta · 1.2s delay
    setTimeout(() => {
      const ctx = getContextKey(location.pathname, params.id);
      const pool = MOCK_RESPONSES[ctx] ?? MOCK_RESPONSES.default!;
      const response =
        pool[Math.floor(Math.random() * pool.length)] ??
        'Estoy en modo demo. Pronto integraré con Claude API real para respuestas reales.';
      addMessage({ role: 'assistant', content: response });
      setThinking(false);
    }, 1200);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop · solo mobile */}
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/30 md:hidden"
        onClick={close}
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col border-l border-line bg-bg-elev shadow-xl animate-[slideInRight_.3s_ease_both]">
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        {/* Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md text-white"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #6B84E8)' }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-semibold">Copiloto IA</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
                Modo demo · contextual
              </div>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={clearMessages}
              title="Limpiar conversación"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={close}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-3 hover:bg-bg-sunken"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-ink-3 text-[13px] py-12">
              Pregúntame algo sobre tu ERP
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {msg.role === 'assistant' && (
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
                    style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #6B84E8)' }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                )}
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-[12.5px] leading-relaxed max-w-[85%]',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-bg-sunken text-foreground',
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
          {thinking && (
            <div className="flex gap-2 items-center">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
                style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #6B84E8)' }}
              >
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              </div>
              <div className="bg-bg-sunken rounded-lg px-3 py-2">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-pulse" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-pulse" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-line p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              className="h-10 flex-1 rounded-md border border-line bg-bg-elev px-3 text-[13px] outline-none placeholder:text-ink-4 focus:border-primary"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              className="flex h-10 w-10 items-center justify-center rounded-md text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), #6B84E8)' }}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-wider text-ink-4">
            Demo · respuestas mock · próximamente Claude API
          </div>
        </div>
      </aside>
    </>
  );
}
