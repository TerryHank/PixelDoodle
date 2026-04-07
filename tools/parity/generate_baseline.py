import json

from main import palette


def main():
    print(json.dumps({"colors": palette.colors, "presets": palette.presets}, ensure_ascii=False))


if __name__ == "__main__":
    main()
