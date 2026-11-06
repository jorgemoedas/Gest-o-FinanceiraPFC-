#!/usr/bin/env python3
import argparse
from pathlib import Path
from aiosmtpd.controller import Controller


class Handler:
    def __init__(self, output: Path):
        self.output = output

    async def handle_DATA(self, server, session, envelope):
        self.output.write_bytes(envelope.content)
        return '250 Message accepted for local validation'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    controller = Controller(Handler(args.output), hostname=args.host, port=args.port)
    controller.start()
    print(f'smtp_collector_listening={args.host}:{args.port}', flush=True)
    try:
        controller.loop.run_forever()
    except KeyboardInterrupt:
        pass
    finally:
        controller.stop()


if __name__ == '__main__':
    main()
