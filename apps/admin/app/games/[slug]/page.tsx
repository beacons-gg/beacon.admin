import { PageBody } from "@/components/primitives";
import { notFound } from "next/navigation";
import { PluginHost } from "@/features/games";
import { GAME_PLUGINS, pluginFor } from "@/features/games/plugins";

/**
 * Every plugin's page is built ahead; a slug no plugin claims is a 404, not a runtime lookup. With
 * no plugins there is no page to build, and every `/games/<slug>` is a 404.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return GAME_PLUGINS.map((plugin) => ({ slug: plugin.slug }));
}

/** A game plugin's screen, inside the host the console gives every plugin. */
export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const plugin = pluginFor((await params).slug);
  if (!plugin) notFound();
  const { Screen } = plugin;
  return (
    <PageBody>
      <PluginHost game={plugin.slug}>
        <Screen />
      </PluginHost>
    </PageBody>
  );
}
