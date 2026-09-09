import { ComputeNav } from "@/components/telligence/ComputeNav";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";

export default function Page() {
  return (
    <>
      <ComputeNav />
      <div id="compute-content" className="compute-container pb-20 sm:pb-28">
        <section
          aria-labelledby="home-heading"
          className="relative grid gap-8 border-b border-melon-300 pb-14 pt-14 sm:pb-20 sm:pt-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-12 lg:pt-24"
        >
          <div className="relative z-10">
            <h1
              id="home-heading"
              className="mt-7 text-[clamp(2.8rem,6.2vw,6rem)] leading-[1.03] tracking-[-0.075em]"
            >
              Throw money
              <br />
              at a problem
              <br />
              together
            </h1>
            <p className="mt-8 max-w-[46ch] text-base leading-7 tracking-[-0.025em] text-melon-800 sm:text-lg sm:leading-8">
              Fund the compute behind work you believe in.
              <br className="hidden xl:block" /> Give an idea a daily allowance to keep going.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-5">
              <Button asChild size="lg" className="h-12">
                <Link href="/create">Submit</Link>
              </Button>
            </div>
            <p className="mt-6 text-xs leading-6 text-melon-700">
              Built on Revnets. Powered by Venice. At home on Base.
            </p>
          </div>
          <div className="relative flex min-w-0 flex-col justify-end lg:-mr-6">
            <div className="relative -mx-5 flex min-h-52 items-end justify-center sm:min-h-72 lg:-ml-24 lg:min-h-0 lg:flex-1">
              <Image
                src="/assets/img/fig-tree-cutout.webp"
                alt="A broad fig tree, growing room for many branches"
                width={1200}
                height={800}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 70vw, 50vw"
                priority
                className="h-auto max-h-[28rem] w-full object-contain object-bottom mix-blend-multiply"
              />
            </div>
          </div>
        </section>
        <section
          aria-label="How compute fundraising works"
          className="grid border-b border-melon-300 py-8 md:grid-cols-2 md:py-10 lg:grid-cols-4"
        >
          <div className="pb-6 md:border-r md:border-melon-300 md:pb-8 md:pr-8 lg:pb-0">
            <p className="compute-eyebrow">01 / A purpose</p>
            <p className="mt-3 text-sm leading-7">
              Tell people what you&apos;re working towards and why it needs compute.
            </p>
          </div>
          <div className="border-t border-melon-300 py-6 md:border-t-0 md:pb-8 md:pt-0 md:pl-8 lg:border-r lg:py-0 lg:pr-8">
            <p className="compute-eyebrow">02 / People who believe</p>
            <p className="mt-3 text-sm leading-7">
              Contributions help grow backing for recurring inference.
            </p>
          </div>
          <div className="border-t border-melon-300 py-6 md:border-r md:pb-0 md:pt-8 md:pr-8 lg:border-t-0 lg:px-8 lg:py-0">
            <p className="compute-eyebrow">03 / A key to get going</p>
            <p className="mt-3 text-sm leading-7">
              Put your API key to work while daily capacity is available.
            </p>
          </div>
          <div className="border-t border-melon-300 pt-6 md:pt-8 md:pl-8 lg:border-t-0 lg:pt-0">
            <p className="compute-eyebrow">04 / Share the rewards</p>
            <p className="mt-3 text-sm leading-7">
              Return rewards to the revnet for supporters to share.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
