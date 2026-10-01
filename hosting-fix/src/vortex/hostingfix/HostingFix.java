package vortex.hostingfix;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.tree.CommandNode;
import net.fabricmc.api.ModInitializer;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Map;

/**
 * Hilfs-Mod fuer "Welt hosten" im Launcher (laeuft nur auf dem Server).
 *
 * e4mc prueft beim Befehl /e4mc auf einem Server die Rechte mit
 * CommandSourceStack.hasPermission(int). Die Methode gibt es in 1.21.11 und
 * 26.x nicht mehr -- sobald ein Spieler joint, schickt der Server ihm die
 * Befehlsliste, prueft dabei /e4mc und stuerzt mit NoSuchMethodError ab.
 *
 * Abhilfe: /e4mc vom Server entfernen. Den Befehl braucht dort niemand, der
 * Launcher steuert den Server; der Tunnel selbst bleibt unberuehrt.
 *
 * Absichtlich ohne Minecraft-Klassen (nur Brigadier + Fabric per Reflection):
 * dieselbe Jar laeuft so auf allen Versionen, egal wie Minecraft die Namen
 * zur Laufzeit nennt.
 */
public class HostingFix implements ModInitializer {
    private static final String LIFECYCLE = "net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents";
    private static final String COMMANDS = "net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback";

    /** Zuletzt gebaute Befehlsliste (wird bei /reload neu gebaut). */
    private static volatile CommandDispatcher<?> letzter;

    @Override
    public void onInitialize() {
        try {
            // Befehlsliste merken -- e4mc meldet /e4mc evtl. erst nach uns an,
            // deshalb wird erst entfernt, wenn alle fertig sind (unten).
            anmelden(COMMANDS, "EVENT", COMMANDS, args -> letzter = (CommandDispatcher<?>) args[0]);
            anmelden(LIFECYCLE, "SERVER_STARTING", LIFECYCLE + "$ServerStarting", args -> entfernen());
            anmelden(LIFECYCLE, "END_DATA_PACK_RELOAD", LIFECYCLE + "$EndDataPackReload", args -> entfernen());
        } catch (Throwable t) {
            System.err.println("[Vortex hosting fix] could not start: " + t);
        }
    }

    private interface Handler { void run(Object[] args) throws Throwable; }

    /** Listener ueber Reflection an ein Fabric-Event haengen. */
    private static void anmelden(String klasse, String feld, String schnittstelle, Handler handler) throws Exception {
        Object event = Class.forName(klasse).getField(feld).get(null);
        Class<?> typ = Class.forName(schnittstelle);
        Object listener = Proxy.newProxyInstance(typ.getClassLoader(), new Class<?>[] { typ }, (proxy, methode, args) -> {
            if (methode.getDeclaringClass() == Object.class) {
                switch (methode.getName()) {
                    case "hashCode": return System.identityHashCode(proxy);
                    case "equals": return proxy == args[0];
                    default: return "VortexHostingFix";
                }
            }
            try { handler.run(args == null ? new Object[0] : args); }
            catch (Throwable t) { System.err.println("[Vortex hosting fix] " + t); }
            return null;
        });
        Method register = Class.forName("net.fabricmc.fabric.api.event.Event").getMethod("register", Object.class);
        register.invoke(event, listener);
    }

    @SuppressWarnings("rawtypes")
    private static void entfernen() throws Exception {
        CommandDispatcher<?> dispatcher = letzter;
        if (dispatcher == null) return;
        CommandNode<?> root = dispatcher.getRoot();
        if (root.getChild("e4mc") == null) return;
        // Brigadier hat kein "remove" -- die Knoten liegen in zwei Maps.
        for (String name : new String[] { "children", "literals" }) {
            Field f = CommandNode.class.getDeclaredField(name);
            f.setAccessible(true);
            ((Map) f.get(root)).remove("e4mc");
        }
        System.out.println("[Vortex hosting fix] removed /e4mc (crashes on this Minecraft version)");
    }
}
