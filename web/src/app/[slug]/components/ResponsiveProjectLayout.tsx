"use client";

import { ProjectContentSkeleton } from "@/components/loading/LoadingSkeletons";
import { useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { ReactNode, Suspense, useEffect, useState } from "react";
import { ProjectMenu } from "./ProjectMenu";
import { PROJECT_SECTIONS_ID } from "./projectSections";

export function ResponsiveProjectLayout({
  sidebar,
  activity,
  preMenu,
  children,
}: {
  sidebar: ReactNode;
  activity: ReactNode;
  preMenu?: ReactNode;
  children: ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const [isSingleColumn, setIsSingleColumn] = useState(false);
  const [activitySelected, setActivitySelected] = useState(segment === null);

  useEffect(() => {
    const singleColumnQuery = window.matchMedia("(max-width: 800px)");
    const apply = () => setIsSingleColumn(singleColumnQuery.matches);
    apply();
    singleColumnQuery.addEventListener("change", apply);
    return () => singleColumnQuery.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (requestedView === "latest") setActivitySelected(true);
    else if (segment || requestedView === "overview") setActivitySelected(false);
  }, [segment, requestedView]);

  const activityActive = isSingleColumn && activitySelected;

  return (
    <div className="mb-10 flex w-full flex-col px-4 pb-5 sm:container min-[801px]:flex-row min-[801px]:gap-10">
      <aside className="contents min-[801px]:flex min-[801px]:w-[300px] min-[801px]:shrink-0 min-[801px]:flex-col">
        <div data-project-layout="sidebar" className="order-1 min-[801px]:order-none">
          {sidebar}
        </div>
        <div
          data-mobile-project-activity
          className={`order-3 ${
            activityActive ? "block" : "hidden"
          } min-[801px]:order-none min-[801px]:block`}
        >
          {activity}
        </div>
      </aside>

      <div className="contents min-[801px]:mx-auto min-[801px]:flex min-[801px]:min-w-0 min-[801px]:max-w-4xl min-[801px]:flex-1 min-[801px]:flex-col min-[801px]:gap-6 min-[801px]:pb-10">
        {preMenu ? (
          <div
            className={`order-3 pt-6 ${
              activityActive ? "hidden" : "block"
            } min-[801px]:order-none min-[801px]:block min-[801px]:pt-0`}
          >
            {preMenu}
          </div>
        ) : null}

        <div
          id={PROJECT_SECTIONS_ID}
          tabIndex={-1}
          data-project-layout="menu"
          className="order-2 mt-2 outline-none min-[801px]:order-none min-[801px]:mt-0"
        >
          <ProjectMenu
            mobileActivityActive={activityActive}
            onMobileActivityChange={setActivitySelected}
          />
        </div>

        <div
          data-mobile-project-content
          className={`order-4 pt-6 ${
            activityActive ? "hidden" : "block"
          } min-[801px]:order-none min-[801px]:block min-[801px]:pt-0`}
        >
          <Suspense fallback={<ProjectContentSkeleton segment={segment} />}>{children}</Suspense>
        </div>
      </div>
    </div>
  );
}
