type IconDefinition = {
  name: string;
  paths: string[];
};

const ICONS: Record<string, IconDefinition> = {
  activity: {
    name: "activity",
    paths: [
      "M3 4H16V18L18 20H5L3 18V4Z",
      "M16 8H21V18L19 20H18",
      "M6 8H9V11H6V8Z",
      "M12 8H14",
      "M12 11H14",
      "M6 14H14",
      "M6 17H14",
    ],
  },
  overview: {
    name: "globe",
    paths: [
      "M8 2H16L20 5L22 9V15L20 19L16 22H8L4 19L2 15V9L4 5L8 2Z",
      "M12 2L8 8V16L12 22",
      "M12 2L16 8V16L12 22",
      "M3 8H21",
      "M3 16H21",
    ],
  },
  rulesets: {
    name: "rules",
    paths: [
      "M12 3V20.25M12 20.25C10.528 20.25 9.1179 20.515 7.81483 21M12 20.25C13.472 20.25 14.8821 20.515 16.1852 21M21.75 5.49087C20.7608 5.28677 19.7604 5.1131 18.75 4.97089C16.5446 4.66051 14.291 4.5 12 4.5C9.70897 4.5 7.45542 4.66051 5.25 4.97089M18.75 4.97089L21.3704 15.6961C21.4922 16.1948 21.2642 16.7237 20.7811 16.8975C20.1468 17.1257 19.4629 17.25 18.75 17.25C18.0371 17.25 17.3532 17.1257 16.7189 16.8975C16.2358 16.7237 16.0078 16.1948 16.1296 15.6961L18.75 4.97089ZM2.25 5.49087C3.23922 5.28677 4.23956 5.1131 5.25 4.97089M5.25 4.97089L7.87036 15.6961C7.9922 16.1948 7.76419 16.7237 7.28114 16.8975C6.6468 17.1257 5.96292 17.25 5.25 17.25C4.53708 17.25 3.8532 17.1257 3.21886 16.8975C2.73581 16.7237 2.5078 16.1948 2.62964 15.6961L5.25 4.97089Z",
    ],
  },
  shop: {
    name: "shop",
    paths: ["M4 8H20L21 22H3L4 8Z", "M8 10V6L10 3H14L16 6V10"],
  },
  owners: {
    name: "stack",
    paths: [
      "M4 5L7 2H17L20 5V19L17 22H7L4 19V5Z",
      "M4 5L7 8H17L20 5",
      "M4 10L7 13H17L20 10",
      "M4 15L7 18H17L20 15",
    ],
  },
  terms: {
    name: "stages",
    paths: ["M3 5L9 2L15 5L21 2V19L15 22L9 19L3 22V5Z", "M9 2V19", "M15 5V22"],
  },
  operator: {
    name: "operator",
    paths: ["M9 3H15L18 6V10L15 13H9L6 10V6L9 3Z", "M3 22V18L7 15H17L21 18V22"],
  },
  extras: {
    name: "extras",
    paths: [
      "M12 2V7L17 12L12 17V22",
      "M12 7L7 12L12 17",
      "M4 3V7",
      "M2 5H6",
      "M20 17V21",
      "M18 19H22",
    ],
  },
};

ICONS.tokens = ICONS.owners;
ICONS.stages = ICONS.terms;
ICONS.owner = ICONS.operator;

function Icon({ definition }: { definition: IconDefinition }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      data-project-tab-icon={definition.name}
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      {definition.paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

export function ProjectTabIcon({ label }: { label: string }) {
  const definition = ICONS[label.toLowerCase().replace(/[^a-z0-9]/g, "")];
  return definition ? <Icon definition={definition} /> : null;
}

export function ProjectOverflowIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      data-project-tab-icon="more"
      className="h-5 w-5 shrink-0"
      fill="currentColor"
    >
      <circle cx="12" cy="6" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="12" cy="18" r="1.25" />
    </svg>
  );
}
