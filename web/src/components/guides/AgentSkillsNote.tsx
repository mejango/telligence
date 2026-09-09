import type { ReactNode } from "react";

const SKILLS_URL = "https://github.com/mejango/juicebox-skills";

export function AgentSkillsNote({
  skills,
  prompt,
}: {
  skills: readonly string[];
  prompt?: ReactNode;
}) {
  return (
    <details className="min-w-0 text-base text-zinc-700">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold text-melon-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-melon-800">
        {prompt ? "Build with an AI assistant" : "Learn with an AI assistant"}
      </summary>
      <p className="mt-2 leading-relaxed">
        Give your assistant the{" "}
        <a href={SKILLS_URL} className="text-melon-900 underline underline-offset-4">
          Juicebox V6 skills
        </a>{" "}
        for contract addresses, interfaces, and economics. Ask it to cite the current contracts so
        you can check its answers{prompt ? " and review proposed transactions before signing" : ""}.
      </p>
      <p className="mt-2 leading-relaxed [overflow-wrap:anywhere]">
        Relevant skills:{" "}
        {skills.map((skill, i) => (
          <span key={skill}>
            {i > 0 ? ", " : ""}
            <code className="text-sm">{skill}</code>
          </span>
        ))}
        .
      </p>
      {prompt}
    </details>
  );
}
