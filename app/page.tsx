// wev landing: Limen-style composition — concrete hero result, the live console,
// mechanism flow, boundary tests, capability stack, judge Q&A. Every word and
// number comes from lib/landing.ts (brief.json and the fixture).
import { loadLanding } from "@/lib/landing";
import { Console } from "@/components/landing/console";
import { BoundaryTests, Capabilities, CountsBand, DevJobs, FAQ, FinalCTA, Footer, Frame, Hero, InspectorFlow, Nav } from "@/components/landing/sections";

export default function Landing() {
  const d = loadLanding();
  return (
    <Frame d={d}>
      <Nav d={d} />
      <main className="flex flex-col">
        <Hero d={d} layout="centered" />
        <CountsBand d={d} />
        <Console
          name={d.name}
          trust={d.trust}
          stateLabels={d.stateLabels}
          fixturePath={d.fixturePath}
        />
        <InspectorFlow gate={d.gate} />
        <BoundaryTests d={d} />
        <Capabilities />
        <FinalCTA d={d} />
      </main>
      <Footer d={d} />
    </Frame>
  );
}
