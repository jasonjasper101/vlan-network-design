# vlan-network-design
# VLSM Network Design & Configuration

Final hands-on exam for CIT 1121 (Introduction to Networks), College of DuPage.

## What I did
Designed a VLSM addressing scheme for a /24 network, split across three 
departments (Sales, Marketing, HR) by host count. Calculated subnets, usable 
ranges, and broadcast addresses for each, then configured the network to match.

## Configuration included
- Router and switch hostnames, login banners, encrypted passwords
- Department-specific default gateways and VLAN addressing
- SSH remote access on one switch
- Verified connectivity via gateway pings and ARP table checks

## Files
- Lab report (docx) with subnetting table and configuration steps

## LAST HOP: CCNA boss-fight game

[`last-hop/`](last-hop/) is a browser game for CCNA 200-301 study. Each boss is one exam domain, and its HP is sized to that domain's exam weight. The first boss, The Mask (Network Fundamentals: subnetting, IPv6, cabling, switching), is playable with 49 tagged questions. See [last-hop/README.md](last-hop/README.md) to run it or add questions.
