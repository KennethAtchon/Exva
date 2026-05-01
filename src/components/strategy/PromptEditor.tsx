export const PromptEditor = ({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) => {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      readOnly={readOnly}
      rows={10}
      style={{
        width: "100%",
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: readOnly ? "var(--surface2)" : "var(--bg)",
        color: "var(--text2)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.5,
        resize: "vertical",
      }}
    />
  );
};
