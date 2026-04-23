import {
  ActionIcon,
  Menu,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconCheck,
  IconDeviceDesktop,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import classes from "./theme-toggle.module.css";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Menu width={180} position="bottom-end" withArrow shadow="md">
      <Menu.Target>
        <Tooltip label={t("Toggle color scheme")}>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("Toggle color scheme")}
          >
            {colorScheme === "auto" ? (
              <IconDeviceDesktop size={18} stroke={1.5} />
            ) : (
              <>
                <IconSun className={classes.light} size={18} stroke={1.5} />
                <IconMoon className={classes.dark} size={18} stroke={1.5} />
              </>
            )}
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={() => setColorScheme("light")}
          leftSection={<IconSun size={16} />}
          rightSection={
            colorScheme === "light" ? <IconCheck size={16} /> : null
          }
        >
          {t("Light")}
        </Menu.Item>
        <Menu.Item
          onClick={() => setColorScheme("dark")}
          leftSection={<IconMoon size={16} />}
          rightSection={
            colorScheme === "dark" ? <IconCheck size={16} /> : null
          }
        >
          {t("Dark")}
        </Menu.Item>
        <Menu.Item
          onClick={() => setColorScheme("auto")}
          leftSection={<IconDeviceDesktop size={16} />}
          rightSection={
            colorScheme === "auto" ? <IconCheck size={16} /> : null
          }
        >
          {t("System settings")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
