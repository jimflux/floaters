import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-0 group-[.toaster]:rounded-tile group-[.toaster]:shadow-xl group-[.toaster]:shadow-aubergine/15 group-[.toaster]:font-sans group-[.toaster]:font-medium",
          // State reads from the icon, the message and a brand edge, never colour alone.
          success: "group-[.toaster]:!border-l-[6px] group-[.toaster]:!border-l-mint",
          error: "group-[.toaster]:!border-l-[6px] group-[.toaster]:!border-l-coral",
          warning: "group-[.toaster]:!border-l-[6px] group-[.toaster]:!border-l-sun",
          info: "group-[.toaster]:!border-l-[6px] group-[.toaster]:!border-l-iris",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:rounded-full group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:rounded-full group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
