import type { Ref } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  /** Sending is blocked while a reply is on its way. */
  disabled: boolean;
  placeholder: string;
  inputRef?: Ref<HTMLTextAreaElement>;
}

/** The message box under a chat: Enter sends, Shift+Enter starts a new line. */
export function ChatInput({ value, onChange, onSend, disabled, placeholder, inputRef }: Props) {
  return (
    <div className="chat-input">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend(value);
          }
        }}
        placeholder={`${placeholder} (Enter to send, Shift+Enter for a new line)`}
      />
      <button className="primary" disabled={!value.trim() || disabled} onClick={() => onSend(value)}>Send</button>
    </div>
  );
}
